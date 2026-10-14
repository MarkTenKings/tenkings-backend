#!/usr/bin/env python3
"""Offline additive catalog projection. Reads archival inputs; writes owned output only.

No network, database writes, production effects, or historical export execution.
All baseline rows retain their exact four strings, order and source metadata.
New exports retain repeated identities with distinct source-row provenance.
"""
import argparse, collections, csv, gc, gzip, hashlib, io, json, os, re, resource, shutil, sqlite3, sys, time
from pathlib import Path
sys.dont_write_bytecode = True

ROOT = None
REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0,str(Path(__file__).resolve().parent))
from panini import HEADERS, clean

SHA = lambda b: hashlib.sha256(b).hexdigest()
ENC = lambda v: json.dumps(v,ensure_ascii=False,separators=(',',':')).encode()
FROZEN = {
 'root-leaf-v2-supplement.json':'0a5cd46e576c2ee33225fc047e9c7c83bb064796bea6b09c265d3cc6eadec752',
 'root-upperdeck-supplement-final.json':'1f2eef82c0f5dee72dff6470b827909017efa9890a316e300584c5e8e57e5720',
 'topps-expansion/normalization-final-receipt.json':'637ea6f53c495916bfc729130bf073b41c103d9bbb4f1baa3ab32f4ed9b94573',
 'load_topps_supplement.py':'0f70695f2d910e1226441cb734f96d56dfbd8951d82ec332440e564f6d33b2cd',
}

def peak_rss_bytes():
 value=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
 return value if sys.platform=='darwin' else value*1024

def retained(path, expected=None, size=None):
 p=(ROOT/path).resolve()
 assert p.is_relative_to(ROOT), ('ARCHIVE_ESCAPE',p)
 b=p.read_bytes()
 assert expected is None or SHA(b)==expected, ('INPUT_HASH',str(p))
 assert size is None or len(b)==size, ('INPUT_SIZE',str(p))
 return b

def save(path, data):
 """Existing identical content is reusable; mismatched output is never overwritten."""
 if path.exists():
  assert path.read_bytes()==data, ('OUTPUT_CONFLICT',str(path))
 else:
  with path.open('xb') as f: f.write(data)

def main():
 global ROOT
 ap=argparse.ArgumentParser()
 ap.add_argument('--archive',type=Path,required=True)
 ap.add_argument('--baseline-data',type=Path,default=REPO/'packages/card-catalog-evidence/data')
 ap.add_argument('--baseline-sha256',required=True)
 ap.add_argument('--output',type=Path,required=True)
 ap.add_argument('--baseline-only',action='store_true')
 ap.add_argument('--upperdeck-five-sports',action='store_true')
 ap.add_argument('--athlete-limit',type=int,choices=[120,512],default=120)
 ap.add_argument('--additional-bundle',type=Path,action='append',default=[])
 ap.add_argument('--additional-sha256',action='append',default=[])
 ap.add_argument('--additional-receipts',type=Path,action='append',default=[])
 args=ap.parse_args();ROOT=args.archive.resolve()
 assert len(args.additional_bundle)==len(args.additional_sha256)==len(args.additional_receipts),'ADDITIONAL_BUNDLE_PROOF_REQUIRED'
 out=args.output.resolve()
 assert out!=ROOT and not out.is_relative_to(ROOT/'raw') and out!=args.baseline_data.resolve(),'OUTPUT_MUST_BE_SEPARATE'
 assert shutil.disk_usage(ROOT).free > 2*1024**3,'DISK_RESERVE'
 out.mkdir(parents=True,exist_ok=True);(out/'manufacturer-checklists').mkdir(exist_ok=True)
 start=time.monotonic();index=[];audit=[];rejected=[];stages=[];sourcekeys=set();inputproof={}
 baseline_count=0

 def stage(name):
  stages.append({'stage':name,'elapsedSeconds':time.monotonic()-start,'peakRssBytes':peak_rss_bytes()})
  print(json.dumps(stages[-1]),flush=True)

 def emit(source, records, origin, provenance, baseline=False):
  assert source['sport'] in ['baseball','basketball','football','hockey','golf']
  identity=SHA(ENC(source));assert identity not in sourcekeys, ('DUPLICATE_METADATA',source)
  sourcekeys.add(identity);strings=[];positions={};rows=[];input_count=0;dupes=0;seen=set();logical=hashlib.sha256()
  def intern(s):
   if s not in positions: positions[s]=len(strings);strings.append(s)
   return positions[s]
  for rec in records:
   rec=list(rec);input_count+=1
   assert len(rec)==4 and all(isinstance(v,str) and v and v==v.strip() and not re.search(r'[\x00-\x1f\x7f]',v) for v in rec), ('INVALID_ROW',source,rec)
   bad=[k for k,limit in enumerate([120,120,args.athlete_limit,160]) if len(rec[k])>limit]
   if bad:
    assert not baseline,('INVALID_BASELINE_ROW',source,rec)
    rejected.append({'source':source,'reason':'current_reader_string_bounds','row':rec,'origin':origin});continue
   key=tuple(rec[:3]);dupes+=int(key in seen);seen.add(key)
   logical.update(ENC(rec)+b'\n');rows.append([0,*[intern(v) for v in rec]])
  if not rows: raise ValueError(('EMPTY_SOURCE',source))
  payload={'schemaVersion':'manufacturer-checklist/v1','complete':False,'sources':[source],'strings':strings,'rows':rows}
  raw=ENC(payload);z=gzip.compress(raw,compresslevel=9,mtime=0)
  assert len(rows)<=100000 and len(raw)<=8*1024*1024 and len(z)<=4*1024*1024, ('SHARD_LIMIT',source,len(rows),len(raw),len(z))
  desc={'path':'manufacturer-checklists/'+SHA(z)+'.json.gz','sha256':SHA(z),'decodedSha256':SHA(raw),'compressedBytes':len(z),'decodedBytes':len(raw),'rowCount':len(rows)}
  save(out/desc['path'],z);index.append({**source,'shard':desc})
  audit.append({'source':source,'origin':origin,'sourceMetadataSha256':identity,'inputRows':input_count,'rows':len(rows),'repeatedIdentityRowsRetained':dupes,'logicalRowsSha256':logical.hexdigest(),'provenance':provenance,'shard':desc})

 data=args.baseline_data.resolve()
 bb=(data/'manufacturer-checklists.json.gz').read_bytes();inputproof['baselineBundle']={'path':str(data/'manufacturer-checklists.json.gz'),'sha256':SHA(bb),'bytes':len(bb)}
 assert SHA(bb)==args.baseline_sha256,'BASELINE_HASH_CHANGED'
 base=json.loads(gzip.decompress(bb));baseline_count=len(base['sources']);baseline_rows=len(base['rows'])
 grouped=collections.defaultdict(list)
 for r in base['rows']:grouped[r[0]].append(r)
 for i,s in enumerate(base['sources']):
  emit(s,([base['strings'][r[k]] for k in range(1,5)] for r in grouped[i]),'current_repository_baseline',inputproof['baselineBundle'],True)
 baseline_sources=base['sources'];del base,grouped;gc.collect()
 assert sum(a['rows'] for a in audit)==baseline_rows
 for f in ['manufacturer-parallel-families.json','manufacturer-product-aliases.json']:
  b=(data/f).read_bytes();save(out/f,b);inputproof[f]={'sha256':SHA(b),'bytes':len(b)}
 stage('baseline_preserved')
 baseline_index=ENC({'schemaVersion':'manufacturer-checklist-index/v2','complete':False,'sources':index})
 save(out/'baseline.index.json',baseline_index)
 if args.baseline_only:
  save(out/'manufacturer-checklists.index.json',baseline_index)
  save(out/'source-audit.json',ENC({'schemaVersion':1,'complete':False,'sources':audit}))
  return

 ledger=sqlite3.connect('file:'+str(ROOT/'panini-acquisition.sqlite')+'?mode=ro&immutable=1',uri=True);ledger.row_factory=sqlite3.Row
 inputproof['paniniLedger']={'sha256':SHA((ROOT/'panini-acquisition.sqlite').read_bytes()),'path':str(ROOT/'panini-acquisition.sqlite')}
 original={s['id']:s for s in json.loads(retained('source-manifest.json'))['sources']}
 originals_by_hash={s['sha256']:s for s in original.values() if s.get('sha256')}
 baseline_products={}
 for source in baseline_sources:
  if source['manufacturer'] not in ['Panini','Donruss','Playoff','Score']:continue
  archived=originals_by_hash[source['sha256']]
  csv_path=ROOT/archived['local_path']
  raw=retained(archived['local_path']) if csv_path.exists() else gzip.decompress(retained(archived['local_path']+'.gz'))
  assert SHA(raw)==source['sha256'] and len(raw)==archived['bytes'],'BASELINE_PANINI_SOURCE_BYTES'
  reader=csv.DictReader(io.StringIO(raw.decode('utf-8-sig')));assert reader.fieldnames==HEADERS
  first=next(reader);key=json.dumps([first['SPORT'].lower(),first['YEAR'],first['BRAND'],first['PROGRAM']],separators=(',',':'))
  baseline_products[key]=source['sha256']
 overlap=[]
 for r in ledger.execute("SELECT * FROM exports WHERE state='validated' ORDER BY sport,year,brand,program"):
  if r['product_key'] in baseline_products:
   assert r['sha256']==baseline_products[r['product_key']],'PANINI_PRODUCT_VERSION_OVERLAP_REQUIRES_REVIEW'
   overlap.append(r['product_key']);continue
  zipped=retained(r['path'],r['gzip_sha256'],r['gzip_bytes']);raw=gzip.decompress(zipped)
  assert SHA(raw)==r['sha256'] and len(raw)==r['bytes']
  reader=csv.DictReader(io.StringIO(raw.decode('utf-8-sig')));assert reader.fieldnames==HEADERS
  brand=clean(r['brand']);program=clean(r['program']);year=clean(r['year']);aliases=[program,brand+' '+program];makers=[brand]
  season=re.search(r'\((\d{2})-(\d{2})\)$',program)
  if season and season[1]==year[-2:]:
   plain=re.sub(r'\s*\(\d{2}-\d{2}\)$','',program);aliases += [plain,brand+' '+plain];year+='-'+season[2]
  if int(year[:4])>=2009:makers.append('Panini')
  s={'manufacturer':brand,'manufacturerAliases':sorted(set(makers)),'sport':r['sport'],'year':year,'setName':f"{r['year']} {brand} {program} {r['sport'].title()}",'aliases':aliases,'url':r['url'],'sha256':r['sha256']}
  def records():
   count=missing=0
   for line,v in enumerate(reader,2):
    assert None not in v and all(x is not None for x in v.values())
    v={k:clean(x) for k,x in v.items()}
    assert (v['SPORT'].lower(),v['YEAR'],v['BRAND'],v['PROGRAM'])==tuple(clean(r[k]) for k in ['sport','year','brand','program'])
    if not all(v[k] for k in ['BRAND','PROGRAM','CARD SET','ATHLETE','CARD NUMBER']):missing+=1;continue
    count+=1;yield v['CARD SET'],v['CARD NUMBER'],v['ATHLETE'],'row:'+str(line)
   assert count==r['rows'] and missing==r['rejected'],('PANINI_COUNT',r['product_key'],count,missing)
  receipt=json.loads(r['receipt_json'])
  assert receipt['sha256']==r['sha256'] and receipt['path']==r['path'] and receipt['capturedAt']==r['captured_at']
  emit(s,records(),'retained_panini_selected_product',{'productKey':r['product_key'],'archivePath':r['path'],'sha256':r['sha256'],'storedSha256':r['gzip_sha256'],'capturedAt':r['captured_at'],'receipt':receipt,'missingIdentityRows':r['rejected']})
 inputproof['paniniProductIdentity']={'baselineProducts':len(baseline_products),'baselineProductKeys':sorted(baseline_products),'identicalEvidenceSkipped':overlap,'retainedUsableProducts':ledger.execute("SELECT count(*) FROM exports WHERE state='validated'").fetchone()[0]}
 stage('panini_selected_products')

 from leaf_normalize import parse_leaf
 leaf=json.loads(retained('root-leaf-v2-supplement.json',FROZEN['root-leaf-v2-supplement.json']))
 for entry in leaf['sources']:
  s=entry['source'];old=original[s['id']]
  assert old['manufacturer']=='Leaf' and old['state']=='needs_parser' and old['row_count']==0
  for k in ['id','manufacturer','sport','year','title','url','sha256','bytes','local_path']:assert s[k]==old[k]
  retained(s['local_path'],s['sha256'],s['bytes'])
  rows,gaps=parse_leaf(ROOT/s['local_path']);assert rows==entry['rows'] and gaps==entry.get('gaps',[]),'LEAF_REPARSE'
  aliases=sorted({json.loads(r['raw_text']).get('set','') for r in rows}-{''});assert len(aliases)<=12
  meta={'manufacturer':'Leaf','manufacturerAliases':['Pro Set'] if 'Pro Set' in s['title'] else [],'sport':s['sport'],'year':s['year'],'setName':s['title'],'aliases':aliases,'url':s['url'],'sha256':s['sha256']}
  emit(meta,((r['subset'],r['card_number'],r['player_name'],'sheet:'+json.loads(r['raw_text'])['sheet']+';row:'+str(r['source_row'])) for r in rows),'retained_leaf_supplement',{'source':s,'supplementSha256':FROZEN['root-leaf-v2-supplement.json'],'fullReparseEquality':True,'gaps':gaps})
 del leaf;gc.collect();stage('leaf_verified_reparse')

 import upperdeck_normalize as ud
 frozen=json.loads(retained('root-upperdeck-supplement-final.json',FROZEN['root-upperdeck-supplement-final.json']))
 assert ud.retained_supplement(ROOT/'upperdeck-expansion')==frozen,'UPPERDECK_REPARSE'
 entries=frozen['sources']
 if args.upperdeck_five_sports:
  ud.SPORTS.update({'Hockey':'hockey','Golf':'golf','Golf - W':'golf'})
  expanded=ud.retained_supplement(ROOT/'upperdeck-expansion')
  old_by_key={SHA(ENC(e['source'])):e for e in entries}
  assert all(old_by_key[SHA(ENC(e['source']))]==e for e in expanded['sources'] if e['source']['sport'] in ['baseball','basketball','football'])
  entries=entries+[e for e in expanded['sources'] if e['source']['sport'] in ['hockey','golf']]
  save(out/'upperdeck-five-sport-audit.json',ENC(expanded['audit']))
 receipts=json.loads(retained('upperdeck-expansion/capture-receipts.json'));receipts={r['sha256']:r for r in receipts}
 for e in entries:
  origin='retained_upperdeck_supplement' if e['source']['sport'] in ['baseball','basketball','football'] else 'retained_upperdeck_hockey_golf_extension'
  emit(e['source'],((r['subset'],r['card_number'],r['player_name'],r['locator']) for r in e['rows']),origin,{'capture':receipts[e['source']['sha256']],'fullReparseEquality':True,'sportAuthority':'literal printed Category cell','supplementSha256':FROZEN['root-upperdeck-supplement-final.json']})
 stage('upperdeck_verified_reparse')

 retained('load_topps_supplement.py',FROZEN['load_topps_supplement.py'])
 sys.path.insert(0,str(ROOT));from load_topps_supplement import validated_topps_entries
 entries,receipt=validated_topps_entries(ROOT,ROOT/'topps-expansion/normalization-final-receipt.json',FROZEN['topps-expansion/normalization-final-receipt.json'])
 for e in entries:
  s=e['source'];meta={'manufacturer':'Topps','manufacturerAliases':[],'sport':s['sport'],'year':s['year'],'setName':s['title'],'aliases':[],'url':s['url'],'sha256':s['sha256']}
  emit(meta,((r['subset'],r['card_number'],r['player_name'],'page:'+str(r['page'])+';row:'+str(r['source_row'])) for r in e['rows']),'retained_topps_supplement',{'source':s,'normalizationReceiptSha256':FROZEN['topps-expansion/normalization-final-receipt.json'],'fullReparseEquality':True})
 stage('topps_verified_reparse')

 for bundle_path, expected, receipts_path in zip(args.additional_bundle,args.additional_sha256,args.additional_receipts):
  # Additional reviewed v1 slices must retain exact normalized bytes and every
  # cited original capture. Source authority is explicit, never manufactured.
  bundle_bytes=bundle_path.read_bytes();assert SHA(bundle_bytes)==expected,'ADDITIONAL_BUNDLE_HASH'
  bundle=json.loads(bundle_bytes)
  assert bundle['schemaVersion']=='manufacturer-checklist/v1' and bundle['complete'] is False
  receipt_bytes=receipts_path.read_bytes();captures=json.loads(receipt_bytes)
  by_hash={r['sha256']:r for r in captures}
  for source_index,source in enumerate(bundle['sources']):
   assert source.get('evidenceAuthority') in ['primary','secondary'],'ADDITIONAL_AUTHORITY_REQUIRED'
   capture=by_hash[source['sha256']]
   assert capture['url']==source['url'] and capture['bytes']==source['sourceBytes']
   assert capture['retrievedAt']==source['retrievedAt'] and capture['sourcePublisher']==source['sourcePublisher']
   assert capture['evidenceAuthority']==source['evidenceAuthority']
   for cited in source.get('normalizationEvidence',[]):
    assert by_hash[cited['sha256']]['url']==cited['url'],'NORMALIZATION_SOURCE_URL'
   proofs=[capture]+[by_hash[p['sha256']] for p in source.get('normalizationEvidence',[])]
   for proof in proofs:
    path=(receipts_path.parent/proof['path']).resolve()
    assert path.is_relative_to(receipts_path.parent.resolve()/'raw'),'CAPTURE_PATH'
    raw=path.read_bytes();assert len(raw)==proof['bytes'] and SHA(raw)==proof['sha256'],'CAPTURE_HASH'
   records=([bundle['strings'][v] for v in r[1:]] if 'strings' in bundle else r[1:] for r in bundle['rows'] if r[0]==source_index)
   emit(source,records,'reviewed_additional_bundle',{'bundlePath':str(bundle_path),'bundleSha256':expected,'receiptsPath':str(receipts_path),'receiptsSha256':SHA(receipt_bytes),'capture':capture,'normalizationCaptures':proofs[1:]})
 stage('additional_reviewed_bundles')

 indexbytes=ENC({'schemaVersion':'manufacturer-checklist-index/v2','complete':False,'sources':index})
 assert len(indexbytes)<=16*1024*1024 and len(index)<=20000
 save(out/'manufacturer-checklists.index.json',indexbytes)
 save(out/'source-audit.json',ENC({'schemaVersion':1,'complete':False,'sources':audit}))
 save(out/'rejected-rows.json',ENC(rejected))
 summary=collections.defaultdict(lambda: {'baselineSources':0,'baselineRows':0,'addedSources':0,'addedRows':0})
 for a in audit:
  s=a['source'];key=(s['manufacturer'],s['sport']);prefix='baseline' if a['origin']=='current_repository_baseline' else 'added'
  summary[key][prefix+'Sources']+=1;summary[key][prefix+'Rows']+=a['rows']
 report={'schemaVersion':'atlas-additive-catalog-candidate/v1','complete':False,'productionCalls':0,'databaseWrites':0,'repoWrites':0,'deployed':False,'baselineSources':baseline_count,'baselineRows':baseline_rows,'sources':len(index),'rows':sum(a['rows'] for a in audit),'addedSources':len(index)-baseline_count,'addedRows':sum(a['rows'] for a in audit)-baseline_rows,'inputRows':sum(a['inputRows'] for a in audit),'rejectedRows':len(rejected),'repeatedIdentityRowsRetained':sum(a['repeatedIdentityRowsRetained'] for a in audit),'compressedShardBytes':sum(s['shard']['compressedBytes'] for s in index),'decodedShardBytes':sum(s['shard']['decodedBytes'] for s in index),'maximumShard':max(audit,key=lambda a:a['shard']['decodedBytes'])['shard'],'indexSha256':SHA(indexbytes),'indexBytes':len(indexbytes),'baselineLogicalRowsPreserved':True,'baselineMetadataAndOrderingPreserved':True,'familyAliasBytesPreserved':True,'inputProof':inputproof,'supplementProof':FROZEN,'summary':[{'manufacturer':k[0],'sport':k[1],**v} for k,v in sorted(summary.items())],'stages':stages,'elapsedSeconds':time.monotonic()-start,'peakRssBytes':peak_rss_bytes(),'freeDiskBytes':shutil.disk_usage(out).free,'athleteLimit':args.athlete_limit,'importerSha256':SHA(Path(__file__).read_bytes()),'parserSha256':{name:SHA((Path(__file__).parent/name).read_bytes()) for name in ['panini.py','leaf_normalize.py','upperdeck_normalize.py','catalog.py']}}
 # Timing is observational; deterministic artifacts above remain immutable/resumable.
 (out/'qualification.json').write_bytes(json.dumps(report,indent=2).encode()+b'\n')
 print(json.dumps({k:v for k,v in report.items() if k not in ['inputProof','summary','stages']}),flush=True)

if __name__=='__main__':main()
