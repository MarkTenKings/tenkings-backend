#!/usr/bin/env python3
"""Import an official Panini UI CSV export, retaining every explicit row.

This adapter reads saved files only. It never calls a private Panini endpoint.
"""
import csv, gzip, hashlib, io, json, re, sys
from pathlib import Path
from catalog import VERSION, clean, norm, now, sha, write_json

HEADERS=['SPORT','YEAR','BRAND','PROGRAM','CARD SET','ATHLETE','TEAM','POSITION','CARD NUMBER','SEQUENCE']

def parse_panini(path):
    data=Path(path).read_bytes();reader=csv.DictReader(io.StringIO(data.decode('utf-8-sig')))
    if reader.fieldnames!=HEADERS:raise ValueError('PANINI_CSV_HEADER_MISMATCH')
    rows=[];identities=set();rejected=[]
    for line,r in enumerate(reader,2):
        if None in r or any(v is None for v in r.values()):raise ValueError(f'PANINI_CSV_TRUNCATED_ROW:{line}')
        r={k:clean(v) for k,v in r.items()};sport=r['SPORT'].lower()
        if sport not in ['baseball','basketball','football']:raise ValueError('PANINI_SPORT_OUTSIDE_SCOPE')
        if not re.fullmatch(r'20\d\d|199\d',r['YEAR']):raise ValueError('PANINI_YEAR_INVALID')
        if not all(r[k] for k in ['BRAND','PROGRAM','CARD SET','ATHLETE','CARD NUMBER']):rejected.append(line);continue
        identities.add((sport,r['YEAR'],r['BRAND'],r['PROGRAM']))
        rows.append({'subset':r['CARD SET'],'card_number':r['CARD NUMBER'],'player_name':r['ATHLETE'],'team':r['TEAM'],
          'rookie':None,'page':None,'source_row':line,'raw_text':json.dumps(r,ensure_ascii=False,separators=(',',':')),'applicability':'explicit_card_row'})
    if len(identities)!=1:raise ValueError('PANINI_MIXED_PRODUCT_EXPORT')
    sport,year,brand,program=next(iter(identities))
    return {'sport':sport,'year':year,'brand':brand,'program':program,'sha256':sha(data),'bytes':len(data),'rows':rows,'rejected':rejected}

def export_bundle(root,db,dest):
    """Small compressed serving projection; originals remain in private archive."""
    sources=[];rows=[];strings=[];string_index={}
    def intern(value):
        if value not in string_index:string_index[value]=len(strings);strings.append(value)
        return string_index[value]
    for s in db.execute("SELECT * FROM sources WHERE state='normalized' ORDER BY manufacturer,year,title"):
        rs=list(db.execute('SELECT * FROM rows WHERE source_id=? ORDER BY page,source_row',(s['id'],)))
        if not rs:continue
        title=s['title'];aliases=[];maker_aliases=[]
        if s['parser']=='panini-explicit-csv/v1':
            first=json.loads(rs[0]['raw_text']);brand=first['BRAND'];program=first['PROGRAM']
            aliases=[program,brand+' '+program]
            season=re.search(r'\((\d{2})-(\d{2})\)$',program)
            if season and season[1]==s['year'][-2:]:
                plain=re.sub(r'\s*\(\d{2}-\d{2}\)$','',program);aliases += [plain,brand+' '+plain]
                s=dict(s);s['year']=s['year']+'-'+season[2]
            maker_aliases=[brand]
            if int(s['year'][:4])>=2009:maker_aliases.append('Panini')
        if s['parser']=='leaf-explicit-cells/v1':
            aliases=sorted({json.loads(r['raw_text']).get('set','') for r in rs} - {''})[:12]
            if 'Pro Set' in title:maker_aliases=['Pro Set']
        source={'manufacturer':s['manufacturer'],'manufacturerAliases':sorted(set(maker_aliases)), 'sport':s['sport'], 'year':s['year'], 'setName':title,
          'aliases':aliases,'url':s['url'],'sha256':s['sha256']}
        idx=len(sources);sources.append(source)
        seen=set()
        for r in rs:
            label=r['subset'];name=r['player_name'];number=r['card_number']
            if len(label)>120 or len(name)>120 or len(number)>120:continue
            key=(label,number,name)
            if key in seen:continue
            seen.add(key);locator=(f"page:{r['page']};" if r['page'] else '')+f"row:{r['source_row']}"
            if s['parser']=='leaf-explicit-cells/v1':locator='sheet:'+json.loads(r['raw_text'])['sheet']+';'+locator
            rows.append([idx,intern(label),intern(number),intern(name),intern(locator)])
    payload={'schemaVersion':VERSION,'complete':False,'sources':sources,'strings':strings,'rows':rows}
    raw=json.dumps(payload,ensure_ascii=False,separators=(',',':')).encode();compressed=gzip.compress(raw,compresslevel=9,mtime=0)
    dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(compressed)
    receipt={'schemaVersion':VERSION,'capturedAt':now(),'complete':False,'sources':len(sources),'explicitRows':len(rows),'gzipBytes':len(compressed),'jsonBytes':len(raw),
      'sha256':sha(compressed),'decodedSha256':sha(raw),'sourceManifestSha256':sha((root/'source-manifest.json').read_bytes()) if (root/'source-manifest.json').exists() else None}
    write_json(dest.with_name('manufacturer-checklists.manifest.json'),receipt)
    return receipt

if __name__=='__main__':
    from catalog import database,export
    import argparse
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);p.add_argument('--csv',type=Path,action='append');p.add_argument('--bundle',type=Path);a=p.parse_args();db=database(a.root)
    for path in a.csv or []:
        parsed=parse_panini(path);url='https://www.paniniamerica.net/checklist.html';sid=sha(json.dumps([url,parsed['sport'],parsed['year'],parsed['brand'],parsed['program']],separators=(',',':')).encode())
        title=f"{parsed['year']} {parsed['brand']} {parsed['program']} {parsed['sport'].title()}"
        # Export selectors disambiguate multiple products on the same official
        # page. A data URL is never presented as a durable evidence URL.
        local=a.root/'raw'/f"{parsed['sha256']}.csv"
        if not local.exists():local.write_bytes(path.read_bytes())
        db.execute('INSERT OR IGNORE INTO sources(id,manufacturer,sport,year,title,url,index_url,discovered_at,state,sha256,bytes,local_path,fetched_at,parser,row_count) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          (sid,parsed['brand'],parsed['sport'],parsed['year'],title,url,url,now(),'normalized',parsed['sha256'],parsed['bytes'],str(local.relative_to(a.root)),now(),'panini-explicit-csv/v1',len(parsed['rows'])))
        for r in parsed['rows']:
            rid=sha(json.dumps([parsed['sha256'],r],sort_keys=True).encode());db.execute('INSERT OR IGNORE INTO rows VALUES(?,?,?,?,?,?,?,?,?,?,?)',(rid,sid,r['subset'],r['card_number'],r['player_name'],r['team'],r['rookie'],r['page'],r['source_row'],r['raw_text'],r['applicability']))
        db.commit();print(json.dumps({'title':title,'rows':len(parsed['rows']),'rejected':len(parsed['rejected'])}))
    export(a.root,db)
    if a.bundle:print(json.dumps(export_bundle(a.root,db,a.bundle)))
