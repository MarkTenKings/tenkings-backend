#!/usr/bin/env python3
"""Offline, resumable manufacturer checklist acquisition and normalization.

No application credentials or production database access. Raw files and SQLite
belong outside the repository. Source snapshots are immutable by SHA-256.
"""
import argparse, csv, hashlib, json, re, sqlite3, sys, time, unicodedata
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen

VERSION = 'manufacturer-checklist/v1'
PARSER = 'topps-explicit-rows/v1'
MAX_BYTES = 30 * 1024 * 1024
SPORTS = ('baseball', 'basketball', 'football')

def sha(b): return hashlib.sha256(b).hexdigest()
def clean(s): return re.sub(r'\s+', ' ', str(s or '')).strip()
def norm(s): return re.sub(r'[^a-z0-9]+', ' ', unicodedata.normalize('NFKD', clean(s)).encode('ascii','ignore').decode().lower()).strip()
def now(): return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
def write_json(p, value):
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp=p.with_suffix(p.suffix+'.tmp');tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n');tmp.replace(p)

def database(root):
    root.mkdir(parents=True, exist_ok=True)
    db=sqlite3.connect(root/'catalog.sqlite');db.row_factory=sqlite3.Row
    db.executescript('''PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY, manufacturer TEXT NOT NULL, sport TEXT, year TEXT, title TEXT NOT NULL, url TEXT NOT NULL, index_url TEXT NOT NULL, discovered_at TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'indexed', sha256 TEXT, bytes INTEGER, local_path TEXT, fetched_at TEXT, problem TEXT, parser TEXT, row_count INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS rows(id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id), subset TEXT NOT NULL, card_number TEXT NOT NULL, player_name TEXT NOT NULL, team TEXT, rookie INTEGER, page INTEGER, source_row INTEGER, raw_text TEXT NOT NULL, applicability TEXT NOT NULL CHECK(applicability='explicit_card_row'));
    CREATE INDEX IF NOT EXISTS row_source_lookup ON rows(source_id,page,source_row);
    CREATE INDEX IF NOT EXISTS row_lookup ON rows(card_number,player_name);
    CREATE INDEX IF NOT EXISTS source_lookup ON sources(manufacturer,year,sport);
    ''');return db

def sport_from(title, url=''):
    t=norm(title+' '+urlparse(url).path)
    if re.search(r'\b(soccer|uefa|premier league|bundesliga|mls|ucl|ucc|uwcl)\b',t): return None
    for s in SPORTS:
        if s in t:return s
    if re.search(r'\b(nbl|overtime elite|mcdonalds all american)\b',t):return 'basketball'
    if re.search(r'\b(xfl|cfl|ufl|alliance of american football)\b',t):return 'football'
    if re.search(r'\b(mlb|bowman|ginter|gypsy queen|pro debut|shohei ohtani|heritage high number|topps total|topps t206|topps rip|brooklyn collection|archives snapshots|archive snapshots)\b',t):return 'baseball'
    return None

def index_links(db, links, manufacturer, index_url):
    count=0
    for x in links:
        title=clean(x.get('title'));url=x.get('url','')
        if not title or not url.startswith('https://') or not re.search(r'\.(pdf|xlsx?|csv)(?:\?|$)|/pages/checklist/',url,re.I):continue
        year=re.search(r'\b(19\d{2}|20\d{2})(?:[-/](?:20)?(\d{2}))?',title)
        if not year or not 1990<=int(year[1])<=2026:continue
        y=year[1]+('-'+year[2] if year[2] else '')
        sport=x.get('sport') or sport_from(title,url)
        db.execute('INSERT OR IGNORE INTO sources(id,manufacturer,sport,year,title,url,index_url,discovered_at) VALUES(?,?,?,?,?,?,?,?)',(sha(url.encode()),manufacturer,sport,y,title,url,index_url,now()));count+=1
    db.commit();return count

def download_one(root, row):
    try:
        req=Request(row['url'],headers={'User-Agent':'TenKingsChecklistCatalog/1.0 (public checklist archival)'})
        with urlopen(req,timeout=45) as res:
            b=res.read(MAX_BYTES+1)
            if len(b)>MAX_BYTES:raise ValueError('SOURCE_TOO_LARGE')
            if not (b.startswith(b'%PDF-') or b.startswith(b'PK\x03\x04') or row['url'].split('?')[0].endswith('.csv')):raise ValueError('UNSUPPORTED_SOURCE_CONTENT')
            digest=sha(b);suffix='.pdf' if b.startswith(b'%PDF-') else '.xlsx' if b.startswith(b'PK') else '.csv'
            p=root/'raw'/f'{digest}{suffix}';p.parent.mkdir(exist_ok=True)
            if not p.exists():p.write_bytes(b)
            return (row['id'],'downloaded',digest,len(b),str(p.relative_to(root)),now(),None)
    except Exception as e:return (row['id'],'unavailable',None,None,None,now(),clean(str(e))[:250])

def fetch_sources(root,db,limit,manufacturer=None):
    rows=[dict(r) for r in db.execute("SELECT * FROM sources WHERE state='indexed' AND sport IS NOT NULL ORDER BY year DESC,title") if not manufacturer or r['manufacturer']==manufacturer][:limit]
    with ThreadPoolExecutor(max_workers=3) as pool:
        for i,result in enumerate(pool.map(lambda r:download_one(root,r),rows),1):
            sid,*vals=result;db.execute('UPDATE sources SET state=?,sha256=?,bytes=?,local_path=?,fetched_at=?,problem=? WHERE id=?',(*vals,sid));db.commit()
            if i%25==0 or i==len(rows):print(json.dumps({'fetched':i,'scheduled':len(rows)}),flush=True)

CARD = re.compile(r'^(?:\d{1,5}[A-Z]?|[A-Z0-9]{1,12}[-–][A-Z0-9-]{1,18})$')
GROUP_HEADINGS={'BASE','INSERT','INSERTS','AUTOGRAPH','AUTOGRAPHS','RELIC','RELICS','CHECKLIST'}

def topps_pdf_rows(path):
    """Conservative positioned-text extraction. Never expand parallel families.

    Only explicit card rows under an observed section are retained; each row has
    a page/line pointer. Oversized/odds/product prose is not a card row. Multiple
    athletes on one card remain a single printed player string.
    """
    import pdfplumber
    subset=None;out=[];rejected=[]
    with pdfplumber.open(path) as pdf:
        for pn,page in enumerate(pdf.pages,1):
            words=page.extract_words(x_tolerance=1.5,y_tolerance=2)
            lines=[]
            for w in words:
                if not lines or abs(w['top']-lines[-1][0]['top'])>2:lines.append([])
                lines[-1].append(w)
            for ln,words in enumerate(lines,1):
                words=sorted(words,key=lambda w:w['x0']);raw=clean(' '.join(w['text'] for w in words))
                if not raw:continue
                first=words[0]['text'];is_card=bool(CARD.fullmatch(first)) and len(words)>1
                if not is_card:
                    if raw==raw.upper() and any(c.isalpha() for c in raw) and len(raw)<150 and not re.search(r'CHECKLIST|SUBJECT TO CHANGE|TOPPS.COM|COPYRIGHT|PAGE \d',raw):
                        if raw not in GROUP_HEADINGS:subset=raw
                    continue
                if not subset:continue
                # Card number is followed by a name and then an actual printed
                # column gap. Wrapped/merged/multi-column rows are quarantined.
                groups=[]
                for w in words[1:]:
                    if not groups or w['x0']-groups[-1][-1]['x1']>=17:groups.append([])
                    groups[-1].append(w)
                vals=[clean(' '.join(w['text'] for w in g)) for g in groups]
                if not vals or not re.search(r'[A-Za-z]',vals[0]) or len(vals[0])>120 or len(vals)>5:
                    rejected.append({'page':pn,'line':ln,'text':raw});continue
                # Most manufacturer PDFs have fixed player/team columns. If no
                # discernible column boundary exists, keep raw evidence only.
                if len(vals)<2:
                    rejected.append({'page':pn,'line':ln,'text':raw});continue
                player=vals[0];team=vals[1];rookie=1 if any(re.fullmatch(r'Rookie|RC',v,re.I) for v in vals[2:]) else None
                if re.search(r'\b(Rookie|RC)$',team):team=re.sub(r'\s+(Rookie|RC)$','',team);rookie=1
                if re.search(r'\b(CARDS|BASE|PARALLEL|NUMBER|PLAYER|TEAM)\b',player) and player==player.upper():continue
                out.append({'subset':subset,'card_number':first,'player_name':player,'team':team,'rookie':rookie,'page':pn,'source_row':ln,'raw_text':raw,'applicability':'explicit_card_row'})
    return out,rejected

def normalize_sources(root,db,limit):
    sources=list(db.execute("SELECT * FROM sources WHERE state='downloaded' AND manufacturer='Topps' AND local_path LIKE '%.pdf' ORDER BY year DESC,title LIMIT ?",(limit,)))
    for i,s in enumerate(sources,1):
        try:
            p=root/s['local_path']
            if sha(p.read_bytes())!=s['sha256']:raise ValueError('SOURCE_HASH_MISMATCH')
            rows,rejected=topps_pdf_rows(p)
            for r in rows:
                rid=sha(json.dumps([s['sha256'],r],sort_keys=True).encode())
                db.execute('INSERT OR IGNORE INTO rows VALUES(?,?,?,?,?,?,?,?,?,?,?)',(rid,s['id'],r['subset'],r['card_number'],r['player_name'],r['team'],r['rookie'],r['page'],r['source_row'],r['raw_text'],r['applicability']))
            db.execute('UPDATE sources SET state=?,parser=?,row_count=?,problem=? WHERE id=?',('normalized' if rows else 'needs_parser',PARSER,len(rows),f'{len(rejected)} ambiguous positioned rows quarantined' if rejected else None,s['id']))
            if rejected:write_json(root/'quarantine'/f"{s['id']}.json",rejected)
            db.commit()
        except Exception as e:
            db.execute('UPDATE sources SET state=\'needs_parser\',problem=? WHERE id=?',(clean(str(e))[:250],s['id']));db.commit()
        if i%10==0 or i==len(sources):print(json.dumps({'normalized':i,'scheduled':len(sources)}),flush=True)

def coverage(db):
    return {'schemaVersion':VERSION,'capturedAt':now(),'requestedYears':{'from':1990,'through':2026},'complete':False,
      'sources':[dict(r) for r in db.execute('SELECT manufacturer,sport,year,state,count(*) AS sources,sum(row_count) AS explicitRows FROM sources GROUP BY manufacturer,sport,year,state ORDER BY manufacturer,year,sport,state')],
      'counts':{'indexedSources':db.execute('SELECT count(*) FROM sources').fetchone()[0],'retainedFiles':db.execute('SELECT count(*) FROM sources WHERE sha256 IS NOT NULL').fetchone()[0],'explicitRows':db.execute('SELECT count(*) FROM rows').fetchone()[0]},
      'limitations':['No archive is asserted complete. Indexed links are not normalized card coverage.','Topps official index states pre-2018 checklists are unavailable.','Set-wide parallel descriptions are never multiplied over cards.','Physical applicability remains unconfirmed until staff review.','Unparsed, unavailable and ambiguous rows remain explicit gaps.']}

def export(root,db):
    write_json(root/'coverage.json',coverage(db))
    write_json(root/'source-manifest.json',{'schemaVersion':VERSION,'sources':[dict(r) for r in db.execute('SELECT * FROM sources ORDER BY manufacturer,year,title')]})
    dest=root/'setops';dest.mkdir(exist_ok=True)
    with (dest/'cards.csv').open('w') as f:
        w=csv.writer(f);w.writerow(['set_id','card_number','player_name','team','subset','rookie','source_url','source_sha256','source_page','source_row'])
        for r in db.execute('SELECT s.title,r.card_number,r.player_name,r.team,r.subset,r.rookie,r.page,r.source_row,s.url,s.sha256 FROM rows r JOIN sources s ON s.id=r.source_id ORDER BY s.title,r.page,r.source_row'):
            w.writerow([r['title'],r['card_number'],r['player_name'],r['team'],r['subset'],r['rookie'],r['url'],r['sha256'],r['page'],r['source_row']])

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--root',type=Path,required=True);sub=ap.add_subparsers(dest='command',required=True)
    p=sub.add_parser('index');p.add_argument('--links',type=Path,required=True);p.add_argument('--manufacturer',required=True);p.add_argument('--index-url',required=True)
    p=sub.add_parser('fetch');p.add_argument('--limit',type=int,default=50);p.add_argument('--manufacturer')
    p=sub.add_parser('normalize');p.add_argument('--limit',type=int,default=20)
    sub.add_parser('export');sub.add_parser('coverage')
    args=ap.parse_args();db=database(args.root)
    if args.command=='index':print(json.dumps({'indexed':index_links(db,json.loads(args.links.read_text()),args.manufacturer,args.index_url)}))
    elif args.command=='fetch':fetch_sources(args.root,db,args.limit,args.manufacturer)
    elif args.command=='normalize':normalize_sources(args.root,db,args.limit)
    elif args.command=='export':export(args.root,db)
    else:print(json.dumps(coverage(db),indent=2))
if __name__=='__main__':main()
