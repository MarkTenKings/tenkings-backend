#!/usr/bin/env python3
"""Conservative Leaf CSV/XLSX row adapter; never expands parallel prose.

Only explicit per-card cells produce colors. Duplicate color headings, internal
p01 columns, freeform parallel descriptions and unsupported sheets are retained
as parser gaps. A blank color cell never produces a candidate.
"""
import argparse, csv, json, re, warnings
from collections import Counter
from pathlib import Path
from catalog import clean, norm, now, sha, write_json, database, export

PARSER='leaf-explicit-cells/v1'
ALIASES={'card set':'set','player name':'name','checklist #':'checklist','name oscar':'name','name temp':'name'}
META={'set','subset','name','checklist','foil','mem','base','note','notes','note card','redemption','redemption status','city','city designation','most recent mlb team','plates','short print','short print info','kp asset id'}
COLORS=re.compile(r'\b(?:silver|gold|platinum|bronze|white|black|blue|red|green|orange|purple|pink|yellow|rainbow|holo|foil|gray|grey|navy|emerald|sparkle|prismatic|crystal|lava|mojo|kaleidoscope|shimmer|pewter|copper|aqua|teal|rose)\b',re.I)

def field(s):
    n=norm(s);return ALIASES.get(n,n)

def present(value):
    v=clean(value)
    return bool(re.fullmatch(r'[1-9]\d*(?:\.0)?',v) or v.lower() in {'yes','unnumbered','not numbered','unlimited'})

def parse_sheet(values,sheet):
    output=[];gaps=[];headers=None;fields=[];colorcols=[];blocked=False
    for rownum,values in enumerate(values,1):
        vals=[clean(v) for v in values];fs=[field(v) for v in vals]
        if 'subset' in fs and 'name' in fs and 'checklist' in fs:
            headers=vals;fields=fs;counts=Counter(f for f in fs if f);blocked=any(n>1 for f,n in counts.items() if f not in {'name'})
            # Two different name columns cannot silently disagree.
            unknown=[i for i,f in enumerate(fs) if f and f not in META and not COLORS.search(f)]
            blocked=blocked or bool(unknown)
            colorcols=[i for i,f in enumerate(fs) if f and f not in META and COLORS.search(f)]
            if blocked:gaps.append({'sheet':sheet,'row':rownum,'reason':'ambiguous_or_unknown_headers','headers':headers})
            continue
        if not headers or blocked:continue
        vals+=['']*max(0,len(fields)-len(vals));get=lambda k:vals[fields.index(k)] if k in fields else ''
        name=get('name');number=get('checklist');subset=get('subset')
        if not all([name,number,subset]) or len(number)>40 or len(name)>120 or len(subset)>100:continue
        if len(set(vals[i] for i,f in enumerate(fields) if f=='name' and vals[i]))>1:
            gaps.append({'sheet':sheet,'row':rownum,'reason':'conflicting_names'});continue
        # Notes can describe a different printing. Do not silently collapse a
        # row with freeform notes into a similarly named parallel.
        notes=' '.join(vals[i] for i,f in enumerate(fields) if f in {'note','notes','note card'} and vals[i])
        if notes and norm(notes) not in {'redemption','sp','ssp','short print','autograph redemption'}:
            gaps.append({'sheet':sheet,'row':rownum,'reason':'freeform_printing_note','note':notes});continue
        foil=get('foil');labels=[]
        if colorcols:
            for i in colorcols:
                if present(vals[i]):labels.append(clean(' '.join([subset,foil,headers[i]])))
                elif vals[i] and norm(vals[i]) not in {'no','n a','0','na','none','nfs'}:
                    gaps.append({'sheet':sheet,'row':rownum,'column':i+1,'reason':'unsupported_print_run','value':vals[i]})
        else:labels=[clean(' '.join([subset,foil]))]
        for label in labels:
            output.append({'subset':label,'card_number':number,'player_name':name,'team':get('city designation') or get('city') or get('most recent mlb team'),'rookie':None,'page':None,'source_row':rownum,
              'raw_text':json.dumps({'sheet':sheet,'row':rownum,'headers':headers,'values':vals,'set':get('set'),'printing':label},ensure_ascii=False,separators=(',',':')),'applicability':'explicit_card_row'})
    if not headers:gaps.append({'sheet':sheet,'reason':'unsupported_header'})
    return output,gaps

def parse_leaf(path):
    path=Path(path);allrows=[];gaps=[]
    if path.suffix=='.csv':sheets=[('CSV',list(csv.reader(path.open(encoding='utf-8-sig'))))]
    elif path.suffix=='.xlsx':
        import openpyxl
        with warnings.catch_warnings():
            warnings.simplefilter('ignore');wb=openpyxl.load_workbook(path,read_only=True,data_only=True);sheets=[(s.title,list(s.values)) for s in wb];wb.close()
    else:raise ValueError('LEAF_FORMAT_NEEDS_PARSER')
    for sheet,values in sheets:
        rows,rejected=parse_sheet(values,sheet);allrows.extend(rows);gaps.extend(rejected)
    return allrows,gaps

def ingest(root,db):
    products=json.loads((root/'leaf-products.json').read_text());counts=Counter()
    for p in products:
        for f in p.get('files',[]):
            if not p.get('sport'):continue
            year=re.search(r'\b(19\d\d|20\d\d)(?:[-/](?:20)?(\d\d))?',p['title'])
            if not year:continue
            year=year[1]+('-'+year[2] if year[2] else '')
            sid=sha(json.dumps([p['url'],f['url']]).encode());state=f.get('state','unavailable');rows=[];gaps=[];problem=f.get('problem')
            if state=='downloaded':
                try:
                    path=root/f['localPath']
                    if sha(path.read_bytes())!=f['sha256']:raise ValueError('SOURCE_HASH_MISMATCH')
                    rows,gaps=parse_leaf(path);state='normalized' if rows else 'needs_parser';problem=f'{len(gaps)} row/sheet gaps' if gaps else None
                except Exception as e:state='needs_parser';problem=str(e)
            db.execute('INSERT OR IGNORE INTO sources(id,manufacturer,sport,year,title,url,index_url,discovered_at,state,sha256,bytes,local_path,fetched_at,problem,parser,row_count) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
              (sid,'Leaf',p['sport'],year,p['title'],f['url'],p['url'],p.get('capturedAt',now()),state,f.get('sha256'),f.get('bytes'),f.get('localPath'),p.get('capturedAt'),problem,PARSER,len(rows)))
            for r in rows:
                rid=sha(json.dumps([sid,f['sha256'],r],sort_keys=True).encode());db.execute('INSERT OR IGNORE INTO rows VALUES(?,?,?,?,?,?,?,?,?,?,?)',(rid,sid,r['subset'],r['card_number'],r['player_name'],r['team'],r['rookie'],r['page'],r['source_row'],r['raw_text'],r['applicability']))
            if gaps:write_json(root/'quarantine'/f'{sid}.json',gaps)
            db.commit();counts[state]+=1;counts['explicitRows']+=len(rows)
    return dict(counts)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);a=p.parse_args();db=database(a.root);print(json.dumps(ingest(a.root,db)));export(a.root,db)
