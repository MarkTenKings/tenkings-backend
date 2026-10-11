import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from upperdeck_normalize import parse_capture, retained_supplement


def capture(rows):
    table = [['Set Name', 'Card', 'Description', 'Category'], *rows]
    return {'url': 'https://upperdeck.com/checklist/2025-goodwin-champions-checklist/',
            'title': '2025 Goodwin Champions Checklist', 'capturedAt': '2026-10-10T00:00:00Z',
            'rowCounts': [len(table)], 'tables': [table]}


class UpperDeckCaptureTests(unittest.TestCase):
    def test_literal_sports_and_printings(self):
        rows, audit = parse_capture(capture([
            ['Base Set', '1', 'Player A', 'Basketball'],
            ['Base Set Red', '2', 'Player B', 'Basketball - W'],
            ['Autographs', 'A3', 'Player C', 'Football'],
            ['Base Set', '4', 'Player D', 'Baseball'],
            ['Base Set', '5', 'Player E', 'Hockey'],
            ['Base Set', '6', 'Player F', 'Athlete']]))
        self.assertEqual([r['subset'] for r in rows['basketball']], ['Base Set', 'Base Set Red'])
        self.assertEqual(rows['football'][0]['locator'], 'table:1;row:4')
        self.assertEqual(len(rows['baseball']), 1)
        self.assertEqual(audit['skipped'], {'outside_requested_sports': 2})
        self.assertEqual(audit['capturedRows'], 6)

    def test_multi_sport_explicit_category_and_missing_identity(self):
        rows, audit = parse_capture(capture([
            ['Dual Auto', 'D1', 'Player A / Player B', 'Basketball/Baseball'],
            ['Base Set', '', 'Player C', 'Football']]))
        self.assertEqual(rows['basketball'], rows['baseball'])
        self.assertEqual(rows['basketball'][0]['category'], 'Basketball/Baseball')
        self.assertEqual(audit['skipped']['missing_explicit_card_identity'], 1)

    def test_incomplete_capture_and_digital_layout_rejected(self):
        payload = capture([['Base Set', '1', 'Player A', 'Basketball']])
        payload['rowCounts'][0] += 1
        with self.assertRaisesRegex(ValueError, 'INCOMPLETE_CAPTURE'):
            parse_capture(payload)
        with self.assertRaisesRegex(ValueError, 'HEADER_MISMATCH'):
            parse_capture({'rowCounts': [1], 'tables': [[['Display Order', 'Checklist Type', 'ID', 'Card Type']]]})
        with self.assertRaisesRegex(ValueError, 'COLUMN_MISMATCH'):
            parse_capture(capture([['Base Set', '1', 'Player A']]))

    def test_blank_spreadsheet_columns_only_ignore_empty_cells(self):
        payload = capture([['Base Set', '1', 'Player A', 'Basketball']])
        for row in payload['tables'][0]: row.extend(['', ''])
        rows, _ = parse_capture(payload)
        self.assertEqual(len(rows['basketball']), 1)
        payload['tables'][0][1][-1] = 'Unlabeled printing detail'
        with self.assertRaisesRegex(ValueError, 'UNNAMED_DATA'):
            parse_capture(payload)

    def test_receipt_and_bytes_are_bound_without_source_mutation(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); (root / 'raw').mkdir()
            payload = capture([['Base Set', '1', 'Player A', 'Basketball']])
            raw = json.dumps(payload).encode(); digest = hashlib.sha256(raw).hexdigest()
            source = root / 'raw' / (digest + '.json'); source.write_bytes(raw)
            receipt = {k: payload[k] for k in ['url', 'title', 'rowCounts']}
            receipt.update(path='raw/' + source.name, bytes=len(raw), sha256=digest, completeTableCapture=True)
            (root / 'capture-receipts.json').write_text(json.dumps([receipt]))
            result = retained_supplement(root)
            self.assertEqual(result['sources'][0]['source']['aliases'], ['Goodwin Champions'])
            self.assertEqual(result['sources'][0]['source']['sha256'], digest)
            self.assertFalse(result['complete'])
            self.assertEqual(source.read_bytes(), raw)
            source.write_bytes(raw + b' ')
            with self.assertRaisesRegex(ValueError, 'SOURCE_HASH_MISMATCH'):
                retained_supplement(root)

    def test_official_index_title_supplies_missing_heading_and_retains_season(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); (root / 'raw').mkdir()
            payload = capture([['Base Set', '1', 'Player A', 'Basketball']])
            payload['title'] = ''
            raw = json.dumps(payload).encode(); digest = hashlib.sha256(raw).hexdigest()
            (root / 'raw' / 'source.json').write_bytes(raw)
            receipt = {k: payload[k] for k in ['url', 'title', 'rowCounts']}
            receipt.update(path='raw/source.json', bytes=len(raw), sha256=digest, completeTableCapture=True)
            (root / 'capture-receipts.json').write_text(json.dumps([receipt]))
            self.assertEqual(retained_supplement(root)['audit'][0]['problem'], 'UPPERDECK_SOURCE_YEAR')
            index = json.dumps([{'url': payload['url'], 'title': '2025-26 Example Checklist'}]).encode()
            (root / 'discovered-products.json').write_bytes(index)
            result = retained_supplement(root)
            self.assertEqual(result['sources'][0]['source']['year'], '2025-26')
            self.assertEqual(result['sources'][0]['source']['aliases'], ['Example'])
            self.assertTrue(result['audit'][0]['titleFromIndex'])
            self.assertEqual(result['indexSha256'], hashlib.sha256(index).hexdigest())


if __name__ == '__main__':
    unittest.main()
