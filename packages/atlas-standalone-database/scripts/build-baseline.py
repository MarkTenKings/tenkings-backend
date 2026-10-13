"""Offline, exact-snapshot standalone installer generation; never opens a database."""
import hashlib,json,pathlib,re,sys
SOURCE_SHA='b51f938fffafb0a5ca5bf82ff126f35b547f8f09b11791e2762040b370088c52'
sha=lambda x:hashlib.sha256(x.encode() if isinstance(x,str) else x).hexdigest()
root=pathlib.Path(__file__).resolve().parent.parent
source=pathlib.Path(sys.argv[1]);assert sha(source.read_bytes())==SOURCE_SHA,'Authoritative DDL snapshot differs'
data=json.loads(source.read_text());assert data['writes']==0 and data['census']['readOnly']=='on'
d=data['census'];assert d['serverVersion']=='17.11' and not d['customTypes']
assert d['otherRelations']==[{'kind':'S','name':'learning_activation_history_sequence_seq','schema':'atlas_manual'}]
STAFF={'StaffControl','StaffIdentity','StaffBrowser','StaffChallenge','StaffSession','StaffRateBucket','StaffAudit','StaffOperationsGrant','SmsPilotControl','SmsPilotReservation','PublicReaderControl'}
RETIRED_CUSTOMER={'CustomerSubmission','CustomerCard','CustomerCardEvent'}
RETIRED_CONNECTED={'variant_contribution'}
quote=lambda x:'"'+x.replace('"','""')+'"'
qual=lambda s,n:quote(s)+'.'+quote(n)
tables=[t for t in d['tables'] if (t['schema']!='atlas_staff' or t['name'] in STAFF) and not(t['schema']=='atlas_customer' and t['name'] in RETIRED_CUSTOMER) and not(t['schema']=='atlas_manual_connected' and t['name'] in RETIRED_CONNECTED)]
selected={(t['schema'],t['name']) for t in tables}
retired_audit={'StaffAudit_finishing_commit','StaffAudit_identity_correction','StaffAudit_learning_commit','StaffAudit_operator_release_adoption','StaffAudit_operator_release_adoption_commit','StaffAudit_workspace_operator_control_commit'}
triggers=[t for t in d['triggers'] if (t['schema'],t['table']) in selected and t['name'] not in retired_audit and t['functionOid']!=next(f['oid'] for f in d['functions'] if f['schema']=='atlas_manual' and f['name']=='public_identity_guard')]
needed_staff={t['functionOid'] for t in triggers}
functions=[f.copy() for f in d['functions'] if not(f['schema']=='atlas_manual_connected' and f['name']=='variant_contribution_guard') and (f['schema']!='atlas_staff' or f['oid'] in needed_staff or f['name']=='lock_control') and not (f['schema']=='atlas_customer' and f['name'] in {'card_binding_guard','card_projection','submission_projection'}) and not(f['schema']=='atlas_manual' and f['name']=='public_identity_guard')]
changes=[]
for f in functions:
 before=f['definition']
 if (f['schema'],f['name'])==('atlas_customer','customer_call_v1'):
  assert before.count('sub atlas_customer."CustomerSubmission";')==1
  value=before.replace('sub atlas_customer."CustomerSubmission";','')
  begin=value.index(" ELSIF action='submit' THEN")
  end=value.rindex(" END IF;\n RETURN atlas_customer.problem(404,'NOT_FOUND');")
  value=value[:begin]+value[end:]
  assert 'CustomerSubmission' not in value and 'CustomerCard' not in value
  f['definition']=value
 if (f['schema'],f['name'])==('atlas_staff','operations_change_guard'):
  value=before.replace('  admitted atlas_staff."StaffSourceAdmission"%ROWTYPE; matched boolean:=false;', '  matched boolean:=false;')
  begin=value.index("  IF TG_TABLE_NAME='StaffIdentity' THEN wanted:=")
  end=value.index('  FOR audit IN SELECT',begin)
  value=value[:begin]+"  IF TG_TABLE_NAME<>'StaffIdentity' THEN RAISE EXCEPTION 'Current staff identity audit only'; END IF;\n  wanted:='STAFF_ROSTER_UPDATED';subject:=p->>'id';\n"+value[end:]
  begin=value.index("    IF TG_TABLE_NAME='StaffIdentity' THEN\n")
  end=value.index("    ELSIF TG_TABLE_NAME='StaffAssignment' THEN",begin)
  keep=value[begin+len("    IF TG_TABLE_NAME='StaffIdentity' THEN\n"):end]
  close=value.index('    IF matched IS TRUE',end)
  value=value[:begin]+keep+value[close:]
  f['definition']=value
 if f['definition']!=before:changes.append({'object':f['schema']+'.'+f['name'],'beforeSha256':sha(before),'afterSha256':sha(f['definition']),'reason':'Remove only obsolete submission/specimen/assignment/invoice branches; preserve current auth/profile/identity audit logic'})
# A source-level dependency refusal complements restore and actual runtime tests.
for f in functions:
 assert not re.search(r'\bpublic\s*\.',f['definition']),f['name']
 for schema,name in re.findall(r'(atlas_[a-z_]+)\."([A-Z][A-Za-z]+)"',f['definition']):
  assert (schema,name) in selected,(f['name'],schema,name)
 assert 'AiGrader' not in f['definition'],f['name']
for t in tables:
 for c in t['columns']:assert not c['generated'] and (not c['identity'] or (t['name']=='learning_activation_history' and c['name']=='sequence' and c['identity']=='a' and c['default'] is None)),(t['name'],c['name'])
 for c in t['constraints'] or []:
  if c['type']=='f':
   match=re.fullmatch(r'(atlas_[a-z_]+)\."?([A-Za-z_]+)"?',c['target']);assert match and match.groups() in selected,(t['name'],c['target'])
schemas=sorted({t['schema'] for t in tables})
parts=['-- ATLAS standalone baseline v1. No shared/public migrations or data.','SET check_function_bodies = false;',*[f'CREATE SCHEMA {quote(s)};' for s in schemas]]
for t in tables:
 cols=[]
 for c in t['columns']:
  cols.append('  '+quote(c['name'])+' '+c['type']+(' GENERATED ALWAYS AS IDENTITY' if c['identity']=='a' else '')+(' DEFAULT '+c['default'] if c['default'] is not None else '')+(' NOT NULL' if c['notNull'] else ''))
 parts.append('CREATE TABLE '+qual(t['schema'],t['name'])+' (\n'+',\n'.join(cols)+'\n);')
parts.extend(f['definition'].rstrip()+';' for f in functions)
for group in [('p','u','c','x'),('f',)]:
 for t in tables:
  for c in t['constraints'] or []:
   if c['type'] in group:parts.append('ALTER TABLE '+qual(t['schema'],t['name'])+' ADD CONSTRAINT '+quote(c['name'])+' '+c['definition']+';')
indexes=[i for i in d['indexes'] if (i['schema'],i['table']) in selected and not i['constraint']]
parts.extend(i['definition']+';' for i in indexes)
parts.extend(t['definition']+';' for t in triggers)
parts.append('SET check_function_bodies = true;')
# Revalidate SQL functions after all objects exist; PL/pgSQL gets runtime tests too.
parts.extend(f['definition'].rstrip()+';' for f in functions if '\n LANGUAGE sql\n' in f['definition'])
for s in schemas:
 parts.extend([f'REVOKE ALL ON SCHEMA {quote(s)} FROM PUBLIC;',f'REVOKE ALL ON ALL TABLES IN SCHEMA {quote(s)} FROM PUBLIC;',f'REVOKE ALL ON ALL SEQUENCES IN SCHEMA {quote(s)} FROM PUBLIC;',f'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA {quote(s)} FROM PUBLIC;'])
text='\n\n'.join(parts)+'\n'
assert not re.search(r'public\s*\.|AiGrader|StaffSpecimen|StaffWorkspace|StaffPublicReport|CustomerSubmission|variant_contribution|CustomerCard(?:"|\b)|dblink|postgres_fdw',text,re.I)
(root/'sql/baseline.sql').write_text(text)
manifest={'version':'atlas-standalone-baseline-v1','sourceSnapshotSha256':SOURCE_SHA,'sourceObservedAt':d['observedAt'],'sourceServerVersion':d['serverVersion'],'sourceScope':'Schema definitions only; zero data exported','sqlSha256':sha(text),'schemas':schemas,'tables':[t['schema']+'.'+t['name'] for t in tables],'functions':[{'name':f['schema']+'.'+f['name']+'('+f['args']+')','sha256':sha(f['definition'])} for f in functions],'triggerCount':len(triggers),'nonConstraintIndexCount':len(indexes),'changes':changes,'retiredTables':[t['schema']+'.'+t['name'] for t in d['tables'] if (t['schema'],t['name']) not in selected],'retiredFunctions':[f['schema']+'.'+f['name']+'('+f['args']+')' for f in d['functions'] if f['oid'] not in {x['oid'] for x in functions}],'retiredTriggers':[t['schema']+'.'+t['table']+'.'+t['name'] for t in d['triggers'] if t not in triggers]}
(root/'baseline.manifest.json').write_text(json.dumps(manifest,indent=2,sort_keys=True)+'\n')
print(json.dumps({'tables':len(tables),'functions':len(functions),'triggers':len(triggers),'sqlSha256':manifest['sqlSha256']}))
