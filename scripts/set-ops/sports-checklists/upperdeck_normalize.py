#!/usr/bin/env python3
"""Normalize complete, retained Upper Deck DOM tables by their printed sport."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
from catalog import clean

SPORTS = {'Basketball': 'basketball', 'Basketball W': 'basketball',
          'Basketball - W': 'basketball', 'Baseball': 'baseball',
          'Football': 'football', 'Flag Football': 'football'}


def parse_capture(payload):
    tables = payload['tables']
    if payload['rowCounts'] != [len(t) for t in tables]:
        raise ValueError('UPPERDECK_INCOMPLETE_CAPTURE')
    rows = {sport: [] for sport in sorted(set(SPORTS.values()))}
    categories, skipped = Counter(), Counter()
    for table_number, table in enumerate(tables, 1):
        if not table or table[0][:4] != ['Set Name', 'Card', 'Description', 'Category']:
            raise ValueError('UPPERDECK_HEADER_MISMATCH')
        headers = table[0]
        if len(set(headers)) != len(headers):
            raise ValueError('UPPERDECK_DUPLICATE_HEADER')
        for line, cells in enumerate(table[1:], 2):
            if len(cells) != len(headers):
                raise ValueError(f'UPPERDECK_COLUMN_MISMATCH:{table_number}:{line}')
            row = dict(zip(headers, map(clean, cells)))
            category = row['Category']
            categories[category] += 1
            # A printed multi-sport category applies to each sport it names.
            sports = {SPORTS[c.strip()] for c in category.split('/') if c.strip() in SPORTS}
            if not sports:
                skipped['outside_requested_sports'] += 1
                continue
            if not all(row[k] for k in ['Set Name', 'Card', 'Description']):
                skipped['missing_explicit_card_identity'] += 1
                continue
            normalized = {'subset': row['Set Name'], 'card_number': row['Card'],
                          'player_name': row['Description'],
                          'locator': f'table:{table_number};row:{line}',
                          'category': category}
            for sport in sorted(sports):
                rows[sport].append(normalized.copy())
    return rows, {'categories': dict(categories), 'skipped': dict(skipped),
                  'capturedRows': sum(len(t) - 1 for t in tables)}


def retained_supplement(root):
    root = Path(root).resolve()
    sources, audits = [], []
    for receipt in json.loads((root / 'capture-receipts.json').read_text()):
        if receipt.get('completeTableCapture') is not True:
            raise ValueError('UPPERDECK_INCOMPLETE_RECEIPT')
        path = (root / receipt['path']).resolve()
        if not path.is_relative_to(root / 'raw'):
            raise ValueError('UPPERDECK_SOURCE_PATH')
        raw = path.read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        if len(raw) > 30 * 1024 * 1024 or len(raw) != receipt['bytes'] or digest != receipt['sha256']:
            raise ValueError('UPPERDECK_SOURCE_HASH_MISMATCH')
        payload = json.loads(raw)
        for key in ['url', 'title', 'rowCounts']:
            if payload[key] != receipt[key]:
                raise ValueError('UPPERDECK_RECEIPT_MISMATCH')
        if not re.fullmatch(r'https://upperdeck\.com/checklist/[a-z0-9-]+/', payload['url']):
            raise ValueError('UPPERDECK_SOURCE_URL')
        title = clean(payload['title']).removesuffix(' Checklist')
        year = re.match(r'((?:19|20)\d\d)\b', title)
        if not year:
            raise ValueError('UPPERDECK_SOURCE_YEAR')
        rows, audit = parse_capture(payload)
        for sport, records in rows.items():
            if records:
                sources.append({'source': {'manufacturer': 'Upper Deck',
                    'manufacturerAliases': [], 'sport': sport, 'year': year[1],
                    'setName': title, 'aliases': [title[len(year[1]):].strip()],
                    'url': payload['url'], 'sha256': digest}, 'rows': records})
        audits.append({'url': payload['url'], 'sha256': digest,
                       'rowsBySport': {k: len(v) for k, v in rows.items()}, **audit})
    return {'schemaVersion': 'upperdeck-explicit-supplement/v1', 'complete': False,
            'parser': 'upperdeck-multisport-dom/v1', 'sources': sources, 'audit': audits}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--capture-root', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = retained_supplement(args.capture_root)
    with args.output.open('x') as output:
        json.dump(result, output, ensure_ascii=False, separators=(',', ':'))
    print(json.dumps({'sources': len(result['sources']),
                      'rows': sum(len(s['rows']) for s in result['sources']),
                      'sha256': hashlib.sha256(args.output.read_bytes()).hexdigest()}))
