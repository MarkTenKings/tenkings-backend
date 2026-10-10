#!/usr/bin/env python3
"""Read Leaf's public paginated product index and its published CSV checklists."""
import argparse,csv,io,json,re,time
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin
from urllib.request import urlopen,Request
from catalog import clean,now,sha,write_json,sport_from
class Links(HTMLParser):
    def __init__(self):super().__init__();self.links=[];self.a=None
    def handle_starttag(self,tag,attrs):
        if tag=='a':self.a={'url':dict(attrs).get('href',''),'title':''}
    def handle_data(self,s):
        if self.a:self.a['title']+=s
    def handle_endtag(self,tag):
        if tag=='a' and self.a:self.links.append(self.a);self.a=None

def read(url):
    with urlopen(Request(url,headers={'User-Agent':'TenKingsChecklistCatalog/1.0'}),timeout=40) as r:
        b=r.read(30*1024*1024+1)
        if len(b)>30*1024*1024:raise ValueError('SOURCE_TOO_LARGE')
        return b

def discover(root,maxpages):
    ledgerpath=root/'leaf-index.json';ledger=json.loads(ledgerpath.read_text()) if ledgerpath.exists() else {'pages':[],'products':[],'next':'https://www.leaftradingcards.com/releases','complete':False}
    products={p['url']:p for p in ledger['products']}
    for _ in range(maxpages):
        url=ledger['next']
        if not url:break
        try:b=read(url)
        except Exception as e:ledger['problem']=str(e);break
        html=b.decode();parser=Links();parser.feed(html)
        for link in parser.links:
            if link['url'].startswith('/products/'):
                u=urljoin(url,link['url']);products.setdefault(u,{'url':u,'title':clean(link['title']),'indexUrl':url,'indexSha256':sha(b)})
        ledger['pages'].append({'url':url,'sha256':sha(b),'capturedAt':now()});(root/'raw'/f'{sha(b)}.html').write_bytes(b)
        nextlink=next((l['url'] for l in parser.links if '_page=' in l['url'] and 'LOAD MORE' in l['title'].upper()),None)
        ledger['next']=urljoin(url,nextlink) if nextlink else None;ledger['complete']=not bool(nextlink);ledger['products']=list(products.values());write_json(ledgerpath,ledger)
        if len(ledger['pages'])%10==0:print(json.dumps({'indexPages':len(ledger['pages']),'productPages':len(products)}),flush=True)
    return ledger

def product(root,p):
    receipt={**p,'capturedAt':now()}
    try:
        b=read(p['url']);s=b.decode();parser=Links();parser.feed(s)
        title=re.search(r'<h1[^>]*>(.*?)</h1>',s,re.S);title=clean(re.sub('<[^>]+>','',title[1])) if title else p['title']
        sport=sport_from(title,p['url']);receipt.update(title=title,sport=sport,pageSha256=sha(b));(root/'raw'/f'{sha(b)}.html').write_bytes(b)
        found=[x for x in parser.links if re.search(r'Download.*Checklist',x['title'],re.I)]
        receipt['files']=[]
        for f in found:
            file={'url':f['url'],'title':title,'sport':sport}
            try:
                data=read(f['url']);digest=sha(data);suffix='.pdf' if data.startswith(b'%PDF') else '.xlsx' if data.startswith(b'PK') else '.csv'
                path=root/'raw'/f'{digest}{suffix}';path.write_bytes(data);file.update(sha256=digest,bytes=len(data),localPath=str(path.relative_to(root)),state='downloaded')
            except Exception as e:file.update(state='unavailable',problem=clean(str(e)))
            receipt['files'].append(file)
        receipt['state']='checked' if found else 'no_checklist_link'
    except Exception as e:receipt.update(state='unavailable',problem=clean(str(e)))
    return receipt

def acquire(root,ledger,limit):
    dest=root/'leaf-products.json';receipts=json.loads(dest.read_text()) if dest.exists() else []
    seen={r['url'] for r in receipts};todo=[p for p in ledger['products'] if p['url'] not in seen and sport_from(p['title'],p['url'])][:limit]
    with ThreadPoolExecutor(max_workers=3) as pool:
        for i,r in enumerate(pool.map(lambda p:product(root,p),todo),1):
            receipts.append(r);write_json(dest,receipts)
            if i%20==0 or i==len(todo):print(json.dumps({'productsChecked':i,'scheduled':len(todo),'total':len(receipts)}),flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);p.add_argument('--max-pages',type=int,default=75);p.add_argument('--limit',type=int,default=500);a=p.parse_args();a.root.mkdir(exist_ok=True,parents=True);(a.root/'raw').mkdir(exist_ok=True);ledger=discover(a.root,a.max_pages);acquire(a.root,ledger,a.limit)
