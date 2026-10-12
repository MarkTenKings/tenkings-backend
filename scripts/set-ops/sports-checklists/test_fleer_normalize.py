import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from fleer_normalize import append_bundle, parse_capture, VERSION


class FleerNormalizeTests(unittest.TestCase):
    def capture(self, root, rows, split=False):
        header = ['Form', 'Card', 'First Name', 'Last Name', 'Set Name'] if split else ['Set Name', 'Card', 'Description']
        data = {'url': 'https://upperdeck.com/checklist/2023-fleer-ultra-golf-checklist/',
                'title': '2023 Fleer Ultra Golf Checklist', 'capturedAt': '2026-10-12T00:00:00.000Z',
                'rowCounts': [len(rows) + 1], 'tables': [[header, *rows]]}
        raw = json.dumps(data).encode()
        digest = hashlib.sha256(raw).hexdigest()
        relative = f'raw/{digest}.json'
        (root / 'raw').mkdir(exist_ok=True)
        (root / relative).write_bytes(raw)
        return {k: data[k] for k in ('url', 'title', 'capturedAt', 'rowCounts')} | {
            'sha256': digest, 'bytes': len(raw), 'path': relative, 'completeTableCapture': True}

    def test_literal_rows_no_blank_subset_fill_or_family_expansion(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            receipt = self.capture(root, [['Base Set', '1', 'Tiger Woods'], ['Printing Plates', '1', 'Tiger Woods'],
                                          ['', '2', 'David Duval'], ['Base Set', '1', 'Tiger Woods']])
            source, rows, rejected = parse_capture(root, receipt)
            self.assertEqual(source['sport'], 'golf')
            self.assertEqual([r[1] for r in rows], ['Base Set', 'Printing Plates'])
            self.assertEqual(rows[1][-1], 'table:1;row:3')
            self.assertEqual([r['reason'] for r in rejected], ['missing_explicit_identity', 'duplicate_explicit_identity'])

    def test_split_name_schema_preserves_printed_subset(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            receipt = self.capture(root, [['1', '2', 'Tiger', 'Woods', '2023 Fleer Ultra Golf']], split=True)
            _, rows, rejected = parse_capture(root, receipt)
            self.assertEqual(rows, [[0, '2023 Fleer Ultra Golf', '2', 'Tiger Woods', 'table:1;row:2']])
            self.assertEqual(rejected, [])

    def test_partial_or_altered_capture_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            receipt = self.capture(root, [['Base Set', '1', 'Tiger Woods']])
            for patch in ({'completeTableCapture': False}, {'rowCounts': [2001]}, {'bytes': 1},
                          {'url': 'https://upperdeck.com/checklist/fleer-ultra-superman-checklist/'}):
                with self.assertRaises(ValueError):
                    parse_capture(root, receipt | patch)

    def test_append_preserves_existing_indices_and_prevents_duplicate_import(self):
        base = {'schemaVersion': VERSION, 'complete': False, 'sources': [{'url': 'https://example.com/old'}],
                'strings': ['Old', '1', 'Name', 'row:2'], 'rows': [[0, 0, 1, 2, 3]]}
        extra = {'sources': [{'url': 'https://example.com/new'}], 'rows': [[0, 'New', '1', 'Name', 'table:1;row:2']]}
        merged = append_bundle(base, extra)
        self.assertEqual(merged['sources'][:1], base['sources'])
        self.assertEqual(merged['strings'][:4], base['strings'])
        self.assertEqual(merged['rows'][:1], base['rows'])
        self.assertEqual(merged['rows'][1], [1, 4, 1, 2, 5])
        with self.assertRaisesRegex(ValueError, 'ALREADY_PRESENT'):
            append_bundle(merged, extra)


if __name__ == '__main__':
    unittest.main()
