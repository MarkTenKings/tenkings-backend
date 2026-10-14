"""Adversarial offline checks for the additive export's preservation boundary."""
import gzip
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT=Path(__file__).with_name('export_retained_catalog.py')

class RetainedExportTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
  self.data=self.root/'baseline';self.data.mkdir();self.out=self.root/'candidate'
  source={'manufacturer':'Fleer','manufacturerAliases':[],'sport':'basketball','year':'1992-93','setName':'Fleer','aliases':['Fleer Basketball'],'url':'https://example.test/checklist','sha256':'a'*64}
  self.payload={'schemaVersion':'manufacturer-checklist/v1','complete':False,'sources':[source,{**source,'year':'1993-94','sha256':'b'*64}],'strings':['Slam Dunk','273','Michael Jordan','page:1;row:3','page:2;row:7','Base','MJ'],'rows':[[0,0,1,2,3],[0,0,1,2,4],[0,0,1,2,3],[1,5,6,2,3]]}
  for name in ['manufacturer-parallel-families.json','manufacturer-product-aliases.json']:(self.data/name).write_text('{"fixture":"preserve exact bytes"}\n')
  self.freeze()
 def tearDown(self):self.tmp.cleanup()
 def freeze(self):
  self.frozen=gzip.compress(json.dumps(self.payload).encode(),mtime=0)
  (self.data/'manufacturer-checklists.json.gz').write_bytes(self.frozen)
  self.hash=hashlib.sha256(self.frozen).hexdigest()
 def run_export(self,*args):
  return subprocess.run([sys.executable,str(SCRIPT),'--archive',str(self.root),'--baseline-data',str(self.data),'--baseline-sha256',self.hash,'--output',str(self.out),'--baseline-only',*args],capture_output=True,text=True)
 def test_preserves_source_order_repeated_rows_and_distinct_locators_on_resume(self):
  result=self.run_export();self.assertEqual(result.returncode,0,result.stderr)
  index=(self.out/'manufacturer-checklists.index.json').read_bytes()
  value=json.loads(index)
  self.assertEqual([{k:v for k,v in s.items() if k!='shard'} for s in value['sources']],self.payload['sources'])
  for i,source in enumerate(value['sources']):
   z=(self.out/source['shard']['path']).read_bytes();self.assertEqual(hashlib.sha256(z).hexdigest(),source['shard']['sha256'])
   rows=json.loads(gzip.decompress(z));actual=[[rows['strings'][v] for v in r[1:]] for r in rows['rows']]
   expected=[[self.payload['strings'][v] for v in r[1:]] for r in self.payload['rows'] if r[0]==i]
   self.assertEqual(actual,expected)
  for name in ['manufacturer-parallel-families.json','manufacturer-product-aliases.json']:self.assertEqual((self.out/name).read_bytes(),(self.data/name).read_bytes())
  resumed=self.run_export();self.assertEqual(resumed.returncode,0,resumed.stderr);self.assertEqual((self.out/'manufacturer-checklists.index.json').read_bytes(),index)
 def test_refuses_changed_frozen_baseline(self):
  (self.data/'manufacturer-checklists.json.gz').write_bytes(self.frozen+b'changed')
  result=self.run_export();self.assertNotEqual(result.returncode,0);self.assertIn('BASELINE_HASH_CHANGED',result.stderr)
  self.assertFalse((self.out/'manufacturer-checklists.index.json').exists())
 def test_never_replaces_conflicting_resumable_shard(self):
  self.assertEqual(self.run_export().returncode,0)
  index=json.loads((self.out/'manufacturer-checklists.index.json').read_bytes())
  path=self.out/index['sources'][0]['shard']['path'];path.write_bytes(b'changed')
  result=self.run_export();self.assertNotEqual(result.returncode,0);self.assertIn('OUTPUT_CONFLICT',result.stderr);self.assertEqual(path.read_bytes(),b'changed')
 def test_baseline_row_above_bound_is_not_silently_dropped_or_truncated(self):
  self.payload['strings'][2]='Player Name/'*20+'Final Player';self.freeze()
  refused=self.run_export();self.assertNotEqual(refused.returncode,0);self.assertIn('INVALID_BASELINE_ROW',refused.stderr)
  accepted=self.run_export('--athlete-limit','512');self.assertEqual(accepted.returncode,0,accepted.stderr)
  index=json.loads((self.out/'manufacturer-checklists.index.json').read_bytes());row=json.loads(gzip.decompress((self.out/index['sources'][0]['shard']['path']).read_bytes()))
  self.assertIn(self.payload['strings'][2],row['strings'])

if __name__=='__main__':unittest.main()
