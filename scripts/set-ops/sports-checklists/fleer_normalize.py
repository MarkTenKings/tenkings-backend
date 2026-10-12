#!/usr/bin/env python3
"""Append six verified official Fleer sports DOM captures to a local v1 bundle.

Offline only: no database, network or production access. Each explicit row keeps
its printed subset and table/row locator. No parallel family is expanded. The
allowlist binds sport/product metadata to inspected official checklist pages;
entertainment captures cannot enter the SPORTS provider through this adapter.
"""
import argparse
import gzip
import hashlib
import json
import re
from pathlib import Path

VERSION = 'manufacturer-checklist/v1'
PARSER = 'fleer-upperdeck-explicit-dom/v1'
PREFIX = 'https://upperdeck.com/checklist/'
PRODUCTS = {
    '2016-17-fleer-showcase-checklist/': ('hockey', '2016-17', '2016-17 Fleer Showcase'),
    '2015-16-fleer-showcase-checklist/': ('hockey', '2015-16', '2015-16 Fleer Showcase'),
    '2025-26-fleer-ultra-pwhl-checklist/': ('hockey', '2025-26', '2025-26 Fleer Ultra PWHL'),
    '2025-2026-fleer-ultra-checklist/': ('hockey', '2025-26', '2025-2026 Fleer Ultra'),
    '2026-fleer-ultra-golf/': ('golf', '2026', '2026 Fleer Ultra Golf'),
    '2023-fleer-ultra-golf-checklist/': ('golf', '2023', '2023 Fleer Ultra Golf'),
}


def sha(value):
    return hashlib.sha256(value).hexdigest()


def clean(value):
    if not isinstance(value, str):
        raise ValueError('CAPTURE_CELL_NOT_TEXT')
    return re.sub(r'\s+', ' ', value).strip()


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode()


def parse_capture(root, receipt):
    url = receipt['url']
    if not url.startswith(PREFIX) or url[len(PREFIX):] not in PRODUCTS:
        raise ValueError('FLEER_PRODUCT_NOT_QUALIFIED')
    digest = receipt['sha256']
    if not re.fullmatch(r'[a-f0-9]{64}', digest) or receipt['path'] != f'raw/{digest}.json':
        raise ValueError('CAPTURE_PATH_INVALID')
    path = root / receipt['path']
    if path.is_symlink() or path.stat().st_size > 4 * 1024 * 1024:
        raise ValueError('CAPTURE_BOUNDS')
    raw = path.read_bytes()
    if sha(raw) != digest or len(raw) != receipt['bytes']:
        raise ValueError('CAPTURE_HASH_MISMATCH')
    data = json.loads(raw)
    if data['url'] != url or data['title'] != receipt['title'] or data['capturedAt'] != receipt['capturedAt']:
        raise ValueError('CAPTURE_BINDING_MISMATCH')
    tables = data['tables']
    if receipt.get('completeTableCapture') is not True or len(tables) != 1 or [len(t) for t in tables] != receipt['rowCounts'] or data['rowCounts'] != receipt['rowCounts']:
        raise ValueError('CAPTURE_INCOMPLETE')
    header = tables[0][0]
    split_name = header == ['Form', 'Card', 'First Name', 'Last Name', 'Set Name']
    if not split_name and header[:3] != ['Set Name', 'Card', 'Description']:
        raise ValueError('CAPTURE_HEADER_UNSUPPORTED')
    rows, rejected, seen = [], [], set()
    for line, values in enumerate(tables[0][1:], 2):
        if len(values) != len(header):
            raise ValueError('CAPTURE_ROW_WIDTH')
        cells = dict(zip(header, map(clean, values)))
        label, number = cells['Set Name'], cells['Card']
        name = clean(cells['First Name'] + ' ' + cells['Last Name']) if split_name else cells['Description']
        key = (label, number, name)
        reason = None
        if not all(key):
            reason = 'missing_explicit_identity'
        elif any(len(v) > 120 or re.search(r'[\x00-\x1f\x7f]', v) for v in key):
            reason = 'identity_outside_reader_bounds'
        elif key in seen:
            reason = 'duplicate_explicit_identity'
        if reason:
            rejected.append({'table': 1, 'row': line, 'reason': reason})
            continue
        seen.add(key)
        rows.append([0, label, number, name, f'table:1;row:{line}'])
    sport, year, title = PRODUCTS[url[len(PREFIX):]]
    source = {'manufacturer': 'Fleer', 'manufacturerAliases': ['Upper Deck'], 'sport': sport,
              'year': year, 'setName': title, 'aliases': [], 'url': url, 'sha256': digest}
    return source, rows, rejected


def build_supplement(root):
    receipts = json.loads((root / 'capture-receipts.json').read_text())
    if not isinstance(receipts, list) or len(receipts) > 100:
        raise ValueError('RECEIPT_BOUNDS')
    selected = {r['url']: r for r in receipts if r['url'].startswith(PREFIX) and r['url'][len(PREFIX):] in PRODUCTS}
    if len(selected) != len(PRODUCTS):
        raise ValueError('FLEER_CAPTURE_MISSING')
    sources, rows, evidence = [], [], []
    for slug in PRODUCTS:
        receipt = selected[PREFIX + slug]
        source, explicit, rejected = parse_capture(root, receipt)
        index = len(sources)
        sources.append(source)
        rows.extend([[index, *r[1:]] for r in explicit])
        evidence.append({**receipt, 'source': source, 'normalizedRows': len(explicit), 'rejectedRows': rejected})
    return {'schemaVersion': VERSION, 'complete': False, 'sources': sources, 'rows': rows}, evidence


def append_bundle(base, supplement):
    if base.get('schemaVersion') != VERSION or base.get('complete') is not False or not isinstance(base.get('strings'), list):
        raise ValueError('BASE_BUNDLE_UNSUPPORTED')
    existing = {s['url'] for s in base['sources']}
    if any(s['url'] in existing for s in supplement['sources']):
        raise ValueError('SUPPLEMENT_ALREADY_PRESENT')
    # Keep all original indices and rows unchanged, preserving evidence IDs.
    strings = list(base['strings'])
    lookup = {s: i for i, s in enumerate(strings)}
    def intern(value):
        if value not in lookup:
            lookup[value] = len(strings)
            strings.append(value)
        return lookup[value]
    offset = len(base['sources'])
    extra = [[r[0] + offset, *[intern(v) for v in r[1:]]] for r in supplement['rows']]
    merged = {**base, 'sources': [*base['sources'], *supplement['sources']], 'strings': strings, 'rows': [*base['rows'], *extra]}
    if len(merged['rows']) > 1500000 or len(strings) > 1500000:
        raise ValueError('MERGED_BUNDLE_BOUNDS')
    return merged


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--capture-root', type=Path, required=True)
    parser.add_argument('--base-bundle', type=Path, required=True)
    parser.add_argument('--base-manifest', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args()
    compressed = args.base_bundle.read_bytes()
    manifest = json.loads(args.base_manifest.read_text())
    if len(compressed) > 16 * 1024 * 1024 or sha(compressed) != manifest['sha256']:
        raise ValueError('BASE_BUNDLE_HASH_MISMATCH')
    with gzip.open(args.base_bundle, 'rb') as stream:
        decoded = stream.read(96 * 1024 * 1024 + 1)
    if len(decoded) > 96 * 1024 * 1024 or sha(decoded) != manifest['decodedSha256']:
        raise ValueError('BASE_DECODED_HASH_MISMATCH')
    supplement, evidence = build_supplement(args.capture_root)
    merged = append_bundle(json.loads(decoded), supplement)
    raw = encode(merged)
    output = gzip.compress(raw, compresslevel=9, mtime=0)
    if len(output) > 16 * 1024 * 1024 or len(raw) > 96 * 1024 * 1024:
        raise ValueError('MERGED_BYTE_BOUNDS')
    imported = {'schemaVersion': 'manufacturer-checklist-supplement/v1', 'parser': PARSER, 'complete': False,
                'baseManifest': manifest, 'sources': evidence, 'addedSources': len(supplement['sources']),
                'addedRows': len(supplement['rows']), 'authority': 'Official Upper Deck checklists for the Fleer brand',
                'limitations': ['Partial archive coverage only.', 'No family-wide variants inferred.',
                                'Entertainment and historical Fleer basketball/baseball/football remain outside this import.']}
    import_bytes = json.dumps(imported, ensure_ascii=False, indent=2).encode() + b'\n'
    final = {'schemaVersion': VERSION, 'capturedAt': max(e['capturedAt'] for e in evidence), 'complete': False,
             'sources': len(merged['sources']), 'explicitRows': len(merged['rows']), 'gzipBytes': len(output),
             'jsonBytes': len(raw), 'sha256': sha(output), 'decodedSha256': sha(raw),
             'sourceManifestSha256': sha(import_bytes), 'sourceManifestFile': 'manufacturer-checklists.fleer-import.json'}
    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / 'manufacturer-checklists.json.gz').write_bytes(output)
    (args.output_dir / 'manufacturer-checklists.fleer-import.json').write_bytes(import_bytes)
    (args.output_dir / 'manufacturer-checklists.manifest.json').write_text(json.dumps(final, indent=2) + '\n')
    print(json.dumps({**final, 'addedSources': imported['addedSources'], 'addedRows': imported['addedRows']}))


if __name__ == '__main__':
    main()
