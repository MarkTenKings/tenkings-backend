// Explicit nonce-owned PostgreSQL17 qualification. No serving database is accepted.
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { disposablePostgres } from '../../../frontend/atlas-app/scripts/disposable-postgres.mjs';
import { applyStandaloneBaseline, applyStandaloneMigrations } from '../../atlas-standalone-database/migrate.mjs';
import { standaloneRoleSQL } from '../../atlas-standalone-database/grants.mjs';
import { canonical, digest, requireThat } from '../../atlas-manual-service/src/contract.mjs';
import { createIntakeRepository } from '../../atlas-manual-intake/src/repository.mjs';
import { createLabelRepository } from '../src/label-sheet-repository.mjs';
import { LABEL_JIG_V1 } from '../../atlas-finishing/src/label-sheet-geometry.mjs';
import { renderApprovedBLabel, approvedBStyleInputLines } from '../../atlas-finishing/src/label-approved-b.mjs';
import { renderLabelV4Png, renderLabelBlackInkSvg, LABEL_INDIVIDUAL_EXPORT_PROFILE_V1 } from '../../atlas-finishing/src/label-sheet.mjs';
import { validateApprovedBArtwork } from '../../atlas-finishing/src/label-approved-b-artwork.mjs';
import { LABEL_STYLE_FONT_CATALOG } from '../../atlas-finishing/src/label-style-paint.mjs';
import { prepareLabelStyleRequest, compileLabelStyleSpec } from '../src/label-style-contract.mjs';
import { prepareLabelWordmarkRequest } from '../src/label-wordmark-contract.mjs';
import { compileLabelWordmark } from '../src/label-wordmark-image.mjs';
import sharp from 'sharp';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const output = process.env.ATLAS_LABEL_STYLE_DEFER_EVIDENCE;
assert(output && resolve(output) === output); mkdirSync(output, { recursive: true, mode: 0o700 });
const args = process.argv.slice(2), require = createRequire(import.meta.url);
const { Client } = require(args[args.indexOf('--pg-module') + 1]);
const { PrismaClient, Prisma } = require(resolve(root, 'frontend/atlas-app/.generated/staff-database'));
const cluster = await disposablePostgres(args), checks = [], errors = [], packets = new Map();
const sourceFiles = Object.fromEntries(['src/label-sheet-repository.mjs','test/qualify-label-style-defer-prisma.mjs'].map(name => [name,
  createHash('sha256').update(readFileSync(resolve(root, 'packages/atlas-connected-manual', name))).digest('hex')]));
let admin, prisma, result;
try {
  await cluster.sql('CREATE DATABASE atlas_style_defer');
  admin = new Client({ connectionString: cluster.url('atlas_style_defer') }); await admin.connect();
  await applyStandaloneBaseline(admin); await applyStandaloneMigrations(admin);
  const roles = { staff: 'atlas_defer_staff', manual: 'atlas_defer_main', variant: 'atlas_defer_variant', customer: 'atlas_defer_customer', customerPrivate: 'atlas_defer_private' };
  await admin.query(standaloneRoleSQL(roles)); const password = randomBytes(24).toString('hex');
  await admin.query(`ALTER ROLE ${roles.manual} LOGIN PASSWORD '${password}'`);
  const uri = new URL(cluster.url('atlas_style_defer')); uri.username = roles.manual; uri.password = password;
  prisma = new PrismaClient({ datasources: { db: { url: uri.href } } }); await prisma.$connect();
  const actor = randomUUID(), other = randomUUID();
  for (const id of [actor, other]) await admin.query('INSERT INTO atlas_staff."StaffIdentity"(id,"phoneHash",role) VALUES($1,$2,\'REVIEWER\')', [id, digest(id)]);
  const staff = { id: actor, role: 'REVIEWER', mode: 'PRODUCTION', accessVersion: 1 };
  const boundary = {
    machineOwner: ({ ownerId, accessVersion }) => ({ ...staff, id: ownerId, accessVersion }),
    async transaction(principal, work) {
      return prisma.$transaction(async tx => {
        const refresh = async () => {
          const row = (await admin.query('SELECT role,"accessVersion","revokedAt" FROM atlas_staff."StaffIdentity" WHERE id=$1', [principal.id])).rows[0];
          requireThat(row && !row.revokedAt && row.role === principal.role && row.accessVersion === principal.accessVersion, 403, 'FIXTURE_ACCESS_REVOKED');
          return { principal };
        };
        await refresh(); return work({ tx, principal, refresh });
      }, { timeout: 15000, maxWait: 15000 }).catch(error => { errors.push({ code: error.code, databaseCode: error.meta?.code ?? null }); throw error; });
    },
    machineTransaction(_staff, work) { return this.transaction(staff, work); },
  };
  const intake = createIntakeRepository({ boundary, keyPrefix: 'owned-fixture', maxOriginalBytes: 1024 });
  const makeRepository = () => createLabelRepository({ boundary, validateAccess: ({ tx, cardId }) => intake.assertActiveInTransaction(tx, cardId) });
  const repo = makeRepository();
  const readItem = async id => (await admin.query('SELECT * FROM atlas_manual_connected.label_item WHERE id=$1', [id])).rows[0];
  const children = async id => (await admin.query("SELECT * FROM atlas_manual_connected.label_item WHERE original_item_id=$1 AND purpose='LAYOUT_RETRY' ORDER BY created_at,id", [id])).rows;
  const approveRows = async () => (await admin.query('SELECT to_jsonb(a) value FROM atlas_manual.approval a ORDER BY card_id,action_id')).rows;
  async function seed({ profile = null, code = 'METADATA_OVERFLOW', pending = false, cardId = randomUUID(), version = 1, owner = actor, identity = null, cardProfile = 'POKEMON', finalGrade = 8 } = {}) {
    const actionId = randomUUID(), id = randomUUID(), text = '{}', h = digest(text), createId = randomUUID();
    identity ??= { cardName: 'Sylveon ex', year: '2024', manufacturer: 'The Pokémon Company International', productSet: 'Scarlet & Violet—Surging Sparks', cardNumber: '086/191', parallel: 'English Holofoil' };
    const report = { identity, finalGrade, cardProfile }, reportText = canonical(report), reportHash = digest(reportText);
    if (version === 1) {
      await admin.query('INSERT INTO atlas_manual.card(id,revision,content,content_hash,owner_id,approvers) VALUES($1,1,$2,$3,$4,$5)', [cardId, text, h, owner, owner === actor ? [] : [actor]]);
      await admin.query('INSERT INTO atlas_manual_intake.card(id,pair_id,owner_id,create_request_id,create_request_hash,label) VALUES($1,$2,$3,$4,$5,$6)', [cardId, randomUUID(), actor, createId, digest(createId), identity.cardName ?? identity.playerName]);
      await admin.query('INSERT INTO atlas_manual.public_report_identity(card_id,public_token,report_number) VALUES($1,$2,$3)', [cardId, `ar_${randomBytes(18).toString('base64url')}`, `ATLAS-${randomBytes(6).toString('hex').toUpperCase()}`]);
    }
    await admin.query('INSERT INTO atlas_manual.action(card_id,action_id,actor_id,expected_revision,result_revision,request_hash,request,result) VALUES($1,$2,$3,$6,$7,$4,$5,$5)', [cardId, actionId, actor, h, text, version * 2 - 1, version * 2]);
    await admin.query('INSERT INTO atlas_manual.approval(card_id,action_id,actor_id,source_revision,source_hash,report_hash,report) VALUES($1,$2,$3,$6,$4,$7,$5)', [cardId, actionId, actor, h, reportText, version * 2 - 1, reportHash]);
    await admin.query("INSERT INTO atlas_manual.publication(card_id,action_id,version,mode) VALUES($1,$2,$3,'PRODUCTION')", [cardId, actionId, version]);
    await admin.query("UPDATE atlas_manual.publication SET state='PUBLISHED',manifest=$3,manifest_hash=$4,public_hash=$4,published_at=clock_timestamp() WHERE card_id=$1 AND action_id=$2", [cardId, actionId, text, h]);
    const row = (await admin.query('SELECT p.*,a.source_revision,a.source_hash,a.report_hash FROM atlas_manual.publication p JOIN atlas_manual.approval a USING(card_id,action_id) WHERE p.card_id=$1 AND p.action_id=$2', [cardId, actionId])).rows[0];
    const reportIdentity = (await admin.query('SELECT * FROM atlas_manual.public_report_identity WHERE card_id=$1', [cardId])).rows[0];
    const packet = { report, reportNumber: reportIdentity.report_number, publicToken: reportIdentity.public_token, approvalVersion: version };
    packets.set(actionId, { packet, row });
    const source = { identity, finalGrade, reportNumber: packet.reportNumber, approvalVersion: version, cardProfile };
    const snapshot = canonical({ identity, grade: finalGrade, finalGrade, cardProfile, source });
    if (version === 1) await admin.query(`INSERT INTO atlas_manual_connected.label_item(id,actor_id,access_version,card_id,action_id,approval_version,source_revision,source_hash,report_hash,public_hash,purpose,state,snapshot,snapshot_hash,attempts,code,renderer_profile_hash)
      VALUES($1,$2,1,$3,$4,1,1,$5,$6,$5,'ORIGINAL',$7,$8,$9,$10,$11,$12)`,
      [id, actor, cardId, actionId, h, reportHash, pending ? 'PENDING_RENDER' : 'NEEDS_LAYOUT', pending ? null : snapshot, pending ? null : digest(snapshot), pending ? 0 : 1, pending ? null : code, profile]);
    return { id, cardId, actionId, source, packet, row };
  }
  const pending=await seed({pending:true});
  await admin.query('UPDATE atlas_manual_connected.label_item SET attempts=3 WHERE id=$1',[pending.id]);
  const approvalBefore=await approveRows(),claimed=await repo.claimItem(staff,pending.id);assert.equal(claimed.attempts,4);assert(claimed.claim_id);assert(claimed.lease_until);
  const start=Date.now();await repo.deferItem(staff,claimed);const deferred=await readItem(pending.id);
  assert.equal(deferred.claim_id,claimed.claim_id);assert.equal(deferred.attempts,3);assert.equal(deferred.state,'PENDING_RENDER');assert.equal(deferred.code,'LABEL_STYLE_PROVIDER_PENDING');
  assert(Date.parse(deferred.lease_until)>=start+29000&&Date.parse(deferred.lease_until)<=Date.now()+31000);
  assert.equal(await repo.claimItem(staff,pending.id),null);
  assert.deepEqual(Object.fromEntries(Object.entries(deferred).filter(([k])=>!['lease_until','attempts','code','updated_at'].includes(k))),Object.fromEntries(Object.entries(claimed).filter(([k])=>!['lease_until','attempts','code','updated_at'].includes(k))));
  checks.push('current installed schema accepts deferred claim/lease pair, retains pending state and immutable fields, refunds one attempt, and prevents immediate reclaim');
  await repo.deferItem(staff,claimed);assert.deepEqual(await readItem(pending.id),deferred);
  checks.push('repeating defer for the same claim is idempotent and preserves prior real failure attempts');
  await admin.query("UPDATE atlas_manual_connected.label_item SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[pending.id]);
  const reclaimed=await repo.claimItem(staff,pending.id);assert(reclaimed.claim_id!==claimed.claim_id);assert.equal(reclaimed.attempts,4);
  const reclaimedBefore=await readItem(pending.id);await assert.rejects(repo.deferItem(staff,claimed),{code:'LABEL_CLAIM_CHANGED'});assert.deepEqual(await readItem(pending.id),reclaimedBefore);
  await repo.deferItem(staff,reclaimed);assert.equal((await readItem(pending.id)).attempts,3);
  checks.push('expired deferral can be reclaimed with a new nonce; old claimant cannot delay or refund new work');
  const empty=await seed({pending:true}),emptyBefore=await readItem(empty.id);
  await assert.rejects(repo.deferItem(staff,emptyBefore),{code:'LABEL_CLAIM_CHANGED'});assert.deepEqual(await readItem(empty.id),emptyBefore);
  checks.push('unclaimed item cannot receive a lease or refund');
  const denied=await seed({pending:true}),deniedClaim=await repo.claimItem(staff,denied.id),deniedBefore=await readItem(denied.id);
  await assert.rejects(repo.deferItem({...staff,id:other},deniedClaim),{code:'LABEL_ITEM_NOT_FOUND'});
  await assert.rejects(repo.deferItem({...staff,accessVersion:2},deniedClaim),{code:'FIXTURE_ACCESS_REVOKED'});
  assert.deepEqual(await readItem(denied.id),deniedBefore);
  checks.push('cross-owner and revoked-version callers are rejected before state mutation');
  await seed({cardId:denied.cardId,version:2});
  await assert.rejects(repo.deferItem(staff,deniedClaim),{code:'LABEL_SOURCE_SUPERSEDED'});assert.deepEqual(await readItem(denied.id),deniedBefore);
  checks.push('new approved source supersedes old claimant before defer');
  const approvalAfter=await approveRows();assert(approvalBefore.every(old=>approvalAfter.some(row=>canonical(row)===canonical(old))));
  const original=await seed({pending:true,cardProfile:'SPORTS',finalGrade:10,identity:{playerName:'TreVeyon Henderson',year:'2025',manufacturer:'Panini',productSet:'Rookies & Stars - Thrillers',parallel:'ICE',cardNumber:'20'}});
  const fontCatalog=Object.values(LABEL_STYLE_FONT_CATALOG),photos=['FRONT','BACK'].map(side=>({side,sha256:digest(side),contentType:'image/png',width:32,height:48,byteCount:100}));
  const styleRequest=prepareLabelStyleRequest({approval:{cardId:original.cardId,actionId:original.actionId,approvalVersion:1,publicHash:original.row.public_hash,reportHash:original.row.report_hash},identity:original.source.identity,cardProfile:'SPORTS',photos,lines:approvedBStyleInputLines(original.source.identity,{cardProfile:'SPORTS'})},{fontCatalog,defaultFontId:'knewave'});
  const photoSource={side:'FRONT',sha256:photos[0].sha256,box:{x:.1,y:.2,width:.5,height:.2},basis:'PRINTED_LETTERING',confidence:'HIGH',observation:'Synthetic fixture of brush lettering.'};
  const observation={lines:styleRequest.source.lines.map(line=>({role:line.role,letteringMode:line.role==='variant'?'ORIGINAL_WORDMARK':'CATALOG',letteringDescription:line.role==='variant'?'Bold brush lettering.':'',letteringTraits:line.role==='variant'?['BRUSH','BOLD']:[],fontId:line.role==='variant'?null:'roboto-condensed',fontSource:photoSource,emphasis:'NORMAL',normalizeWordInkHeight:line.role==='variant',spans:line.role==='variant'?[{start:0,end:line.text.length,baseColor:'#92e2ff',accentColor:'#ffffff',pattern:'NONE',opticalScale:1,source:photoSource}]:[]}))};
  const styleSpec=compileLabelStyleSpec(styleRequest,observation,{requestSha256:digest('synthetic-style-request'),responseSha256:digest('synthetic-style-response')});
  const wordmarkRequest=prepareLabelWordmarkRequest({sourceHash:styleSpec.specHash,role:'variant',text:'THRILLERS ICE',traits:['BRUSH','BOLD'],normalizeWordInkHeight:true});
  const bytes=await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1024"><rect width="1536" height="1024" fill="white"/><path fill="black" d="M200 400H850V580H200ZM240 440V540H810V440Z" fill-rule="evenodd"/><rect x="930" y="430" width="120" height="120"/></svg>')).png().toBuffer();
  const image={bytes,sha256:digest(bytes),mimeType:'image/png',width:1536,height:1024};
  const compiled=await compileLabelWordmark({request:wordmarkRequest,image,verification:{sourceHash:styleSpec.specHash,imageSha256:image.sha256,generationRequestKey:wordmarkRequest.requestKey,responseSha256:digest('synthetic-reading'),reading:{transcription:'THRILLERS ICE',singleLine:true,extraMarks:false,confidence:'HIGH',words:[{text:'THRILLERS',x:200,y:400,width:650,height:180},{text:'ICE',x:930,y:430,width:120,height:120}]}}});
  const rendered=renderApprovedBLabel(original.source,{styleSpec,wordmarks:{variant:{descriptor:compiled.descriptor,pngBase64:compiled.bytes.toString('base64'),maskBase64:compiled.maskBytes.toString('base64')}}});
  assert.equal(rendered.state,'READY');validateApprovedBArtwork(rendered);
  const snapshot={identity:original.source.identity,grade:10,finalGrade:10,cardProfile:'SPORTS',reportNumber:original.source.reportNumber,approvalVersion:1,previewMaterial:'gold',source:rendered.source,diagnostics:rendered.diagnostics,styleSpec,labelStyle:{specHash:styleSpec.specHash,alphaSha256:compiled.descriptor.mask.sha256,wordmarkArtifactHash:compiled.descriptor.artifactHash},layoutVersion:rendered.layoutVersion,backArtworkHash:digest(rendered.backPrintSvg)};
  const snapshotBytes=Buffer.byteLength(canonical(snapshot,{maxBytes:32768}));assert.doesNotMatch(canonical(snapshot),/"(?:mask|bytes|pixels|pngBase64|maskBase64)":|data:image/);
  const readyClaim=await repo.claimItem(staff,original.id),ready=await repo.finishItem(staff,readyClaim,{...rendered,row:original.row,snapshot,materialProfileId:'atlas-v4-gold-v1',jigHash:LABEL_JIG_V1.jigHash});
  assert.equal(ready.state,'READY');const saved=await readItem(original.id);assert.equal(saved.snapshot,canonical(snapshot));assert.equal(saved.print_svg,rendered.printSvg);assert.equal(saved.preview_svg,rendered.previewSvg);assert.equal(saved.claim_id,null);assert.equal(saved.lease_until,null);assert(saved.sheet_id);assert(saved.slot);
  const exportInput={slot:1,printSvg:saved.print_svg,artworkHash:saved.artwork_hash,previewMaterial:'gold'};
  const exported=await renderLabelV4Png(exportInput,{exportProfileId:LABEL_INDIVIDUAL_EXPORT_PROFILE_V1.id});assert.equal(digest(exported.bytes),exported.sha256);assert.equal((await sharp(exported.bytes).metadata()).format,'png');assert.equal(exported.manifest.byteCount,exported.bytes.length);
  const black=renderLabelBlackInkSvg(exportInput);assert.match(black,/data-label-wordmark=/);await sharp(Buffer.from(black)).png().toBuffer();
  checks.push(`synthetic original-wordmark alpha fixture persists grade10 READY through the real renderer, existing restricted Prisma grants and immutable schema guards, ${snapshotBytes}-byte binary-free snapshot, and real color/black-ink PNG export`);
  result={status:'ATLAS_LABEL_STYLE_DEFER_PRISMA_PASS',prismaVersion:Prisma.prismaVersion,sourceFiles,checks,providerCalls:0,productionConnections:0,remoteStorageCalls:0,deletionEffects:'OWNED_DISPOSABLE_FIXTURE_ONLY',observedTransactionErrors:errors};
} catch(error){result={status:'ATLAS_LABEL_STYLE_DEFER_PRISMA_FAILED',sourceFiles,checks,error:{name:error.name,code:error.code,meta:error.meta,message:error.message,stack:error.stack},productionConnections:0};process.exitCode=1;}
finally{await prisma?.$disconnect();await admin?.end();await cluster.stop();}
result.cleanup=JSON.parse(readFileSync(resolve(cluster.directory,'cleanup.json')));assert.equal(result.cleanup.stoppedVerified,true);
writeFileSync(resolve(output,'result.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(result,null,2));
