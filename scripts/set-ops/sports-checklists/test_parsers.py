import csv,json,tempfile,unittest
from pathlib import Path
from leaf_normalize import parse_sheet
from panini import parse_panini,HEADERS
from upperdeck import parse_table

class ExplicitScopeTests(unittest.TestCase):
    def test_leaf_blank_cells_are_not_parallel_applicability(self):
        rows,gaps=parse_sheet([['Set','Subset','Name','Checklist','Foil','Blue','Red','Gold','MEM','BASE'],['2026 Leaf Metal Football','Base Auto','Player A','BA-A1','Prismatic','',5,1,'No','Auto']],'Metal')
        self.assertEqual([r['subset'] for r in rows],['Base Auto Prismatic Red','Base Auto Prismatic Gold']);self.assertEqual(gaps,[])
        self.assertEqual(json.loads(rows[0]['raw_text'])['sheet'],'Metal')
    def test_duplicate_color_headers_quarantine_sheet(self):
        rows,gaps=parse_sheet([['Set','Subset','Name','Checklist','Blue','Blue'],['2026 Leaf Football','Auto','Player A','A1',5,1]],'Sheet1')
        self.assertEqual(rows,[]);self.assertEqual(gaps[0]['reason'],'ambiguous_or_unknown_headers')
    def test_setwide_parallel_prose_is_never_expanded(self):
        rows,gaps=parse_sheet([['Subset','Name','Checklist'],['Parallel colors include Blue and Red','',''],['Base Auto','Player A','A1']],'Final')
        self.assertEqual([r['subset'] for r in rows],['Base Auto'])
    def test_freeform_printing_note_is_not_dropped(self):
        rows,gaps=parse_sheet([['Set','Subset','Name','Checklist','Blue','Note'],['2026 Leaf Football','Auto','Player A','A1',5,'Black Version']],'Sheet1')
        self.assertEqual(rows,[]);self.assertEqual(gaps[0]['reason'],'freeform_printing_note')
    def test_panini_rejects_truncated_download(self):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'x.csv'
            with path.open('w') as f:
                w=csv.writer(f);w.writerow(HEADERS);w.writerow(['Football','2024','Donruss','Optic','Rated Rookies','Player A'])
            with self.assertRaisesRegex(ValueError,'TRUNCATED'):parse_panini(path)
    def test_panini_retains_card_specific_full_label(self):
        with tempfile.TemporaryDirectory() as d:
            path=Path(d)/'x.csv'
            with path.open('w') as f:
                w=csv.writer(f);w.writerow(HEADERS);w.writerow(['Football','2024','Donruss','Optic','Rated Rookies Blue Hyper','Drake Maye','New England Patriots','QB','229','99'])
            parsed=parse_panini(path);self.assertEqual(parsed['rows'][0]['subset'],'Rated Rookies Blue Hyper');self.assertEqual(parsed['rows'][0]['card_number'],'229')
    def test_upperdeck_digital_table_is_not_physical_coverage(self):
        with self.assertRaisesRegex(ValueError,'HEADER_MISMATCH'):parse_table({'rows':[['Display Order','Checklist Type','ID','Card Type'],['1','e-Pack','1','Digital']]})
    def test_upperdeck_preamble_preserves_locator(self):
        rows=parse_table({'rows':[['','',''],['Set Name','Card','Description'],['Base Set Gold','1','Player A']]})
        self.assertEqual(rows[0]['source_row'],3);self.assertEqual(rows[0]['subset'],'Base Set Gold')

if __name__=='__main__':unittest.main()
