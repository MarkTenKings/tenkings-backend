import csv,hashlib,json,tempfile,unittest
from pathlib import Path
from leaf_normalize import parse_sheet,retained_gap_supplement
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
    def test_leaf_literal_printing_headers_preserve_names_and_empty_cells(self):
        rows,gaps=parse_sheet([['Subset','Name','Checklist','Foil','Silver','Super','Wave','RWB','Galaxy','Fire'],['Base Auto','Player A','BA1','Prismatic','Yes',1,'',3,'NO',0]],'FINAL')
        self.assertEqual([r['subset'] for r in rows],['Base Auto Prismatic Silver','Base Auto Prismatic Super','Base Auto Prismatic RWB']);self.assertEqual(gaps,[])
    def test_leaf_ancillary_columns_do_not_suppress_explicit_colors_or_create_plates(self):
        rows,gaps=parse_sheet([['Subset','Name','Checklist','Charcoal','Blue','C','M','Y','K'],['Auto','Player A','A1',3,5,1,1,1,1]],'FINAL')
        self.assertEqual([r['subset'] for r in rows],['Auto Charcoal','Auto Blue'])
        self.assertEqual(gaps[0]['reason'],'uninterpreted_ancillary_columns')
        self.assertEqual(json.loads(rows[0]['raw_text'])['values'][-4:],['1','1','1','1'])
        rows,gaps=parse_sheet([['Subset','Name','Checklist','C','M','Y','K'],['Auto','Player A','A1',1,1,1,1]],'FINAL')
        self.assertEqual(rows,[])
    def test_leaf_distribution_and_print_run_notes_remain_in_provenance(self):
        for note in ['Stated Print Runs','Hobby Only','Jumbo Only','Jumbo Only (only 1 of each color)']:
            rows,gaps=parse_sheet([['Subset','Name','Checklist','Blue','Note_Card'],['Auto','Player A','A1',1,note]],'FINAL')
            self.assertEqual([r['subset'] for r in rows],['Auto Blue']);self.assertEqual(gaps,[])
            self.assertEqual(json.loads(rows[0]['raw_text'])['values'][-1],note)
    def test_leaf_no_parallel_note_cannot_override_printing_columns(self):
        rows,gaps=parse_sheet([['Subset','Name','Checklist','Notes'],['Base Auto','Player A','A1','No Parallels exist']],'FINAL')
        self.assertEqual([r['subset'] for r in rows],['Base Auto']);self.assertEqual(gaps,[])
        rows,gaps=parse_sheet([['Subset','Name','Checklist','Blue','Notes'],['Base Auto','Player A','A1',1,'No Parallels exist']],'FINAL')
        self.assertEqual(rows,[]);self.assertEqual(gaps[0]['reason'],'freeform_printing_note')
    def test_leaf_internal_and_duplicate_printing_columns_stay_quarantined(self):
        for cols in [['p01','Blue'],['RWB','RWB']]:
            rows,gaps=parse_sheet([['Subset','Name','Checklist',*cols],['Auto','Player A','A1',1,1]],'FINAL')
            self.assertEqual(rows,[]);self.assertEqual(gaps[0]['reason'],'ambiguous_or_unknown_headers')
    def test_leaf_explicit_unnumbered_cell_does_not_expand_freeform_notes(self):
        rows,gaps=parse_sheet([['Subset','Name','Checklist','Bronze','Note'],['Patch Auto','Player A','A1',"not #'d",'']],'FINAL')
        self.assertEqual([r['subset'] for r in rows],['Patch Auto Bronze']);self.assertEqual(gaps,[])
        rows,gaps=parse_sheet([['Subset','Name','Checklist','White','Note'],['Auto','Player A','A1',1,'Hobby Only - Unnumbered White version not in boxes!']],'FINAL')
        self.assertEqual(rows,[]);self.assertEqual(gaps[0]['reason'],'freeform_printing_note')
    def test_leaf_supplement_is_hash_bound_and_excludes_existing_rows(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);(root/'raw').mkdir();path=root/'raw/source.csv'
            path.write_text('Subset,Name,Checklist,Super\nAuto,Player A,A1,1\n')
            source={'id':'one','manufacturer':'Leaf','state':'needs_parser','row_count':0,'local_path':'raw/source.csv','sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
            manifest=root/'source-manifest.json';manifest.write_text(json.dumps({'sources':[source,{**source,'id':'existing','state':'normalized','row_count':1}]}));before=manifest.read_bytes()
            value=retained_gap_supplement(root)
            self.assertEqual([s['source']['id'] for s in value['sources']],['one']);self.assertFalse(value['complete'])
            self.assertEqual(value['sources'][0]['rows'][0]['subset'],'Auto Super')
            self.assertEqual(manifest.read_bytes(),before);self.assertFalse((root/'catalog.sqlite').exists())
            path.write_text(path.read_text()+'Auto,Player B,B1,1\n')
            with self.assertRaisesRegex(ValueError,'SOURCE_HASH_MISMATCH'):retained_gap_supplement(root)
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
