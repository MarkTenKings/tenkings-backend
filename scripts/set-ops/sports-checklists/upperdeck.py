#!/usr/bin/env python3
"""Import tables saved from the official Upper Deck browser DOM.

The capture JSON contains URL, heading, capture time and every table row; the
adapter validates the literal header and retains source-row provenance.
"""
import argparse,json,re
from pathlib import Path
from catalog import database,clean,sha,export,now

def parse_table(payload):
    table=payload['rows'];offset=0
    while table and not any(table[0]):table=table[1:];offset+=1
    if not table or table[0][:3]!=['Set Name','Card','Description']:raise ValueError('UPPERDECK_HEADER_MISMATCH')
    headers=table[0];out=[]
    for line,vals in enumerate(table[1:],2+offset):
        if len(vals)!=len(headers):raise ValueError(f'UPPERDECK_COLUMN_MISMATCH:{line}')
        r=dict(zip(headers,map(clean,vals)))
        if not all(r.get(k) for k in ['Set Name','Card','Description']):continue
        out.append({'subset':r['Set Name'],'card_number':r['Card'],'player_name':r['Description'],'team':clean(r.get('Team City','')+' '+r.get('Team Name','')),'rookie':1 if r.get('Rookie') else None,'page':None,'source_row':line,'raw_text':json.dumps(r,separators=(',',':')),'applicability':'explicit_card_row'})
    return out

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);a=p.parse_args();db=database(a.root)
    for receipt in json.loads((a.root/'upperdeck-products.json').read_text()):
        path=Path(receipt['path']);b=path.read_bytes();payload=json.loads(b)
        try:rows=parse_table(payload);problem=None
        except ValueError as e:rows=[];problem=str(e)
        digest=sha(b);local=a.root/'raw'/f'{digest}.json';local.write_bytes(b);url=payload['url'];sid=sha(url.encode());title=clean(payload['title']).removesuffix(' Checklist');year=re.search(r'\b20\d\d\b',title)[0]
        db.execute('INSERT OR IGNORE INTO sources(id,manufacturer,sport,year,title,url,index_url,discovered_at,state,sha256,bytes,local_path,fetched_at,parser,row_count,problem) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',(sid,'Upper Deck','football',year,title,url,'https://upperdeck.com/checklists/',payload['capturedAt'],'normalized' if rows else 'needs_parser',digest,len(b),str(local.relative_to(a.root)),payload['capturedAt'],'upperdeck-explicit-table/v1',len(rows),problem))
        for r in rows:
            rid=sha(json.dumps([sid,digest,r],sort_keys=True).encode());db.execute('INSERT OR IGNORE INTO rows VALUES(?,?,?,?,?,?,?,?,?,?,?)',(rid,sid,r['subset'],r['card_number'],r['player_name'],r['team'],r['rookie'],r['page'],r['source_row'],r['raw_text'],r['applicability']))
        db.commit();print(json.dumps({'title':title,'rows':len(rows)}))
    export(a.root,db)
