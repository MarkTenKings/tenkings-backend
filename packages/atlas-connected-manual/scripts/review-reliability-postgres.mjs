// Finite, nonce-owned synthetic PostgreSQL qualification. No ambient DB URL.
import assert from 'node:assert/strict';
import {mkdir,writeFile,copyFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {createOwnedManualFixture} from '../../atlas-manual-service/scripts/owned-fixture.mjs';
import {runReviewDisplayPostgres} from './review-display-postgres.mjs';
import {runLearningPostgres} from '../../atlas-defect-memory/scripts/learning-postgres.mjs';
const output=process.env.ATLAS_RELIABILITY_EVIDENCE;
assert(output&&resolve(output)===output,'Absolute fresh evidence directory required');
await mkdir(output,{mode:0o700});
const sourceFiles=['./review-reliability-postgres.mjs','../../../frontend/atlas-app/scripts/disposable-postgres.mjs','../../../frontend/atlas-app/scripts/remote-disposable-postgres.mjs','../../atlas-manual-service/scripts/owned-fixture.mjs','../src/review-display-store.mjs','../src/published-display-store.mjs','../src/review-display.mjs',
 '../src/thumbnails.mjs','../src/publication-reader.mjs','../src/image-descriptors.mjs','../src/inspection-preview.mjs','./review-display-postgres.mjs',
 '../../atlas-photo-runtime/src/jpeg.mjs','../../atlas-photo-runtime/src/display.mjs','../../atlas-photo-runtime/src/display-worker.mjs',
 '../../atlas-photo-storage/src/index.mjs','../../atlas-defect-memory/src/repository.mjs','../../atlas-defect-memory/src/publication-worker.mjs',
 '../../atlas-defect-memory/src/active-retrieval.mjs','../../atlas-defect-memory/src/role-repository.mjs',
 '../../atlas-defect-memory/src/role-learning.mjs','../../atlas-defect-memory/src/contract.mjs',
 '../../atlas-defect-memory/scripts/learning-postgres.mjs',
 '../../../frontend/atlas-app/prisma/migrations/20260928000400_durable_review_display/migration.sql',
 '../../../frontend/atlas-app/prisma/migrations/20260928120000_learning_publication_outbox/migration.sql'];
const hashes=async()=>Object.fromEntries(await Promise.all(sourceFiles.map(async path=>[path,createHash('sha256').update(await readFile(new URL(path,import.meta.url))).digest('hex')])));
const source=await hashes();
const fixture=await createOwnedManualFixture(process.argv.slice(2));
try{
 await writeFile(join(output,'startup.json'),JSON.stringify({owned:true,directory:fixture.cluster.directory,productionEffects:false,at:new Date().toISOString()},null,2)+'\n',{mode:0o600});
 const display=await runReviewDisplayPostgres({fixture,output});
 const displayOnly=process.env.ATLAS_RELIABILITY_DISPLAY_ONLY==='true';
 const learning=displayOnly?null:await runLearningPostgres({fixture,output});
 assert.deepEqual(await hashes(),source,'Qualification source changed while fixture ran');
 const result={status:displayOnly?'REVIEW_DISPLAY_POSTGRES_PASS':'REVIEW_RELIABILITY_POSTGRES_PASS',display,learning,source,productionEffects:false};
 await writeFile(join(output,'result.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(result));
}finally{
 await fixture.stop();await copyFile(join(fixture.cluster.directory,'cleanup.json'),join(output,'database-cleanup.json'));
 await writeFile(join(output,'cleanup.json'),JSON.stringify({ownedDatabaseStoppedVerified:true,productionEffects:false,at:new Date().toISOString()},null,2)+'\n',{mode:0o600});
}
