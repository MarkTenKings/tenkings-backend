// Explicit fresh, ownership-checked local PostgreSQL only. No serving imports.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir,writeFile,readFile,copyFile } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOwnedManualFixture } from '../../atlas-manual-service/scripts/owned-fixture.mjs';
import { createManualRepository } from '@atlas/manual-service/repository';
import { createManualService } from '@atlas/manual-service';
import { canonical,digest } from '@atlas/manual-service/contract';
import { createPublicationRepository,publicationGrantSQL } from '../src/publication-repository.mjs';
import { createManualPublication } from '../src/publication.mjs';
import { createApprovedManualReader } from '../src/publication-reader.mjs';
import { publicationFixture } from '../test/publication-fixture.mjs';
export async function runPublicationPostgres({ fixture, output }) {
 const checks=[];
 await mkdir(output,{recursive:true,mode:0o700});
 const source=JSON.parse(await readFile(join(fixture.cluster.directory,'source.json')));assert.equal(source.staffMigrations.length,44);
 await fixture.cluster.sql(publicationGrantSQL('atlas_fixture_manual'),[],fixture.database.name);
 const connection=fixture.connect(),{boundary,auth,manualClient}=connection;
 const boot=await auth.bootstrap(''),browserCookie=`${fixture.config.cookies.browser}=${boot.browserToken}`;
 const challenge=await auth.send(browserCookie,boot.csrf,{phone:'+12025550141',requestId:randomUUID()},'fixture-publication');
 const verified=await auth.verify(browserCookie,boot.csrf,{challengeId:challenge.challengeId,code:'424242'},'fixture-publication');
 const cookie=`${browserCookie}; ${fixture.config.cookies.session}=${verified.token}`,staff=await auth.authenticate(cookie,verified.csrf);
 const f=await publicationFixture(),publicationRepository=createPublicationRepository({boundary});
 const repository=createManualRepository({boundary,approvalCommitted:publicationRepository.approvalCommitted});
 await repository.provision(staff,{cardId:f.cardId,draft:f.draft});
 const service=createManualService({repository,reduce:({card})=>card.draft,buildReport:async()=>f.approval});
 const publication=createManualPublication({repository:publicationRepository,artifacts:f.artifacts,storage:f.storage,readSource:async(staff,id,upload)=>({photo:f.photos[upload.side]})});
 const command={actionId:f.actionId,expectedRevision:1,action:{type:'APPROVE_REPORT',reportHash:f.row.report_hash,reviewed:true}};
 const approved=await service.execute(staff,f.cardId,command),savedApproval=await repository.readApproval(staff,f.cardId,f.actionId);
 assert.deepEqual(approved.card.draft,f.draft);assert.equal((await publication.status(staff,f.cardId)).state,'PENDING');
 assert.deepEqual(await service.execute(staff,f.cardId,command),approved);
 checks.push('actual current authenticated reviewer commits one approval, one pending publication and stable identity; exact replay is inert');
 f.failRead();await assert.rejects(publication.publish(staff,f.cardId,f.actionId));assert.equal((await publication.status(staff,f.cardId)).state,'PENDING');
 f.failRead(false);const published=await publication.publish(staff,f.cardId,f.actionId);assert.equal(published.state,'PUBLISHED');assert.equal(published.version,1);
 assert.deepEqual(await publication.publish(staff,f.cardId,f.actionId),published);assert.deepEqual(await repository.readApproval(staff,f.cardId,f.actionId),savedApproval);
 checks.push('storage failure preserves actual PostgreSQL pending intent and approval; explicit original action delivery publishes once');
 const rows=()=>fixture.admin.$queryRawUnsafe('SELECT count(*)::int AS count FROM atlas_manual.publication WHERE card_id=$1::uuid',f.cardId);
 assert.equal((await rows())[0].count,1);
 const before=await service.read(staff,f.cardId),failRepo=createManualRepository({boundary,approvalCommitted:async args=>{await publicationRepository.approvalCommitted(args);throw new Error('fixture late failure');}});
 const failService=createManualService({repository:failRepo,reduce:()=>{},buildReport:async()=>f.approval});
 await assert.rejects(failService.execute(staff,f.cardId,{...command,actionId:randomUUID(),expectedRevision:before.revision}),/fixture late failure/);
 assert.deepEqual(await service.read(staff,f.cardId),before);assert.equal((await rows())[0].count,1);
 const count=await fixture.admin.$queryRawUnsafe('SELECT count(*)::int AS count FROM atlas_manual.approval WHERE card_id=$1::uuid',f.cardId);assert.equal(count[0].count,1);
 checks.push('actual transaction rollback after publication insert leaves card/action/approval/publication counts unchanged');
 for(const sql of ["UPDATE atlas_manual.publication SET public_hash=repeat('0',64) WHERE card_id=$1::uuid",'DELETE FROM atlas_manual.publication WHERE card_id=$1::uuid',"UPDATE atlas_manual.public_report_identity SET report_number='ATLAS-111111111111' WHERE card_id=$1::uuid"]){await assert.rejects(fixture.admin.$executeRawUnsafe(sql,f.cardId));}
 await assert.rejects(manualClient.$executeRawUnsafe('UPDATE atlas_manual.publication SET version=2 WHERE card_id=$1::uuid',f.cardId));
 await assert.rejects(manualClient.$executeRawUnsafe('DELETE FROM atlas_manual.publication WHERE card_id=$1::uuid',f.cardId));
 checks.push('published manifests and public identity are immutable under owner SQL; native role cannot alter identity/version or delete');
 const control={deploymentId:'local-public-fixture',releaseSha:'a'.repeat(40),configHash:'b'.repeat(64)};
 await fixture.admin.$executeRawUnsafe(`INSERT INTO atlas_staff."PublicReaderControl"(id,mode,origin,enabled,revision,"deploymentId","releaseSha","configHash") VALUES('active','LOCAL_FIXTURE','http://127.0.0.1:4319',true,1,$1,$2,$3)`,control.deploymentId,control.releaseSha,control.configHash);
 const publicRow=(await fixture.admin.$queryRawUnsafe('SELECT i.public_token FROM atlas_manual.public_report_identity i WHERE card_id=$1::uuid',f.cardId))[0];
 const claims={...control,expiresAt:Date.now()+30000,request:{kind:'REPORT',token:publicRow.public_token,version:1,side:null,findingId:null}};
 const reader=createApprovedManualReader({client:manualClient,artifacts:f.artifacts,storage:f.storage}),read=await reader.read(claims),packet=JSON.parse(read.bytes).packet;
 assert.equal(packet.reportNumber,published.reportNumber);assert.deepEqual(packet.report.grade,f.full.grade);assert.equal(packet.report.finalGrade,f.full.finalGrade);
 await assert.rejects(reader.read({...claims,configHash:'c'.repeat(64)}));
 assert.equal(await reader.read({...claims,request:{...claims.request,version:2}}),null);
 const image=await reader.read({...claims,request:{...claims.request,kind:'IMAGE',side:'BACK'}});assert.deepEqual(image.bytes,f.bytes.BACK);
 checks.push('restricted native function checks current public deployment/config and exact version; same approved grades and hash-bound media are returned');
 const secondAction=randomUUID(),current=await service.read(staff,f.cardId);await service.execute(staff,f.cardId,{...command,actionId:secondAction,expectedRevision:current.revision});
 const secondStatus=await publication.status(staff,f.cardId,secondAction);assert.equal(secondStatus.version,2);assert.equal(secondStatus.reportNumber,published.reportNumber);
 assert.equal(JSON.parse((await reader.read({...claims,request:{...claims.request,version:null}})).bytes).packet.approvalVersion,1,'pending successor is never public');
 const second=await publication.publish(staff,f.cardId,secondAction);assert.equal(second.version,2);
 assert.equal(JSON.parse((await reader.read(claims)).bytes).packet.approvalVersion,1);
 assert.equal(JSON.parse((await reader.read({...claims,request:{...claims.request,version:null}})).bytes).packet.approvalVersion,2);
 checks.push('same card keeps report number/token across approvals; pending version hidden, published latest advances, version-one link remains exact');
 await fixture.admin.$executeRawUnsafe(`UPDATE atlas_staff."PublicReaderControl" SET enabled=false,revision=revision+1 WHERE id='active'`);
 await assert.rejects(reader.read(claims));
 checks.push('public control disable immediately fences manual report/media reads');
 const functionPrivilege=await fixture.admin.$queryRawUnsafe("SELECT has_function_privilege('atlas_fixture_public','atlas_manual.read_publication(text,integer,text,text,text)','EXECUTE') AS allowed");assert.equal(functionPrivilege[0].allowed,false);
 checks.push('public web database role receives no new native function privilege');
 const result={status:'PASS',assertionGroups:checks.length,checks,migrationCount:source.staffMigrations.length,migrations:source.staffMigrations.slice(-2),syntheticStorageOnly:true,paidEffects:0,remoteEffects:0};
 await writeFile(join(output,'result.json'),JSON.stringify(result,null,2),{mode:0o600});return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 const output=process.env.ATLAS_PUBLICATION_EVIDENCE;
 assert(output&&resolve(output)===output,'Absolute new owned evidence directory required');
 await mkdir(output,{mode:0o700});
 const fixture=await createOwnedManualFixture(process.argv.slice(2));
 try { const result=await runPublicationPostgres({fixture,output}); console.log(JSON.stringify({status:result.status,assertionGroups:result.assertionGroups,output})); }
 finally {await fixture.stop();await copyFile(join(fixture.cluster.directory,'cleanup.json'),join(output,'cleanup.json'));}
}
