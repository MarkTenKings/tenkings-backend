import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
const root = resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const user = "tenkings_nfc_validation", database = "tenkings_ai_grader_nfc_validation";
const stageBoundary = "20261002010000_vault_spark_observation";
const recoveryBoundary = "20261007010000_vault_spark_recovery_finance";
const productionBoundary = "20261007030000_vault_spark_production_stage";
const legacyId = "synthetic-legacy-spark-receipt";

/** Owns exactly one new, loopback-only, tmpfs-backed database. No existing database is accepted. */
export async function startDisposableSparkPostgres() {
  assert.ok(process.argv.includes("--ack-disposable-local-postgres"), "Explicit disposable PostgreSQL acknowledgment required");
  assert.equal(process.versions.node.split(".")[0], "20");
  const directory = mkdtempSync(resolve(tmpdir(), "vault-spark-postgres-"));
  const name = `vault-spark-validation-${randomUUID()}`;
  const password = randomBytes(32).toString("base64url");
  // Public image pulls must not contact a user's desktop credential helper.
  const dockerConfig = resolve(directory, "docker"); mkdirSync(dockerConfig); writeFileSync(resolve(dockerConfig,"config.json"), '{"auths":{}}\n', {mode:0o600});
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, DOCKER_CONFIG:dockerConfig, ...(process.env.DOCKER_HOST ? {DOCKER_HOST:process.env.DOCKER_HOST}: {}) };
  function run(command,args,extra={}) {
    const result=spawnSync(command,args,{cwd:root,env,encoding:"utf8",maxBuffer:8*1024*1024,timeout:180000,...extra});
    const output=`${result.stdout??""}\n${result.stderr??""}`.replaceAll(password,"[SYNTHETIC_PASSWORD]");
    assert.equal(result.status,0,`${command} failed: ${result.error?.message??output.slice(-6000)}`); return output.trim();
  }
  const endpoint=process.env.DOCKER_HOST??run("docker",["context","inspect","--format",'{{ (index .Endpoints "docker").Host }}']);
  assert.ok(endpoint.startsWith("unix://") || endpoint.startsWith("npipe://"),"Local Docker daemon required");
  let started=false;
  const close=async()=>{if(started)run("docker",["rm","-f",name]);rmSync(directory,{recursive:true,force:true});};
  try {
    run("docker",["run","--detach","--name",name,"--label","com.tenkings.disposable=vault-spark-validation","--publish","127.0.0.1::5432","--tmpfs","/var/lib/postgresql/data:rw,noexec,nosuid,size=805306368","--env",`POSTGRES_USER=${user}`,"--env",`POSTGRES_PASSWORD=${password}`,"--env",`POSTGRES_DB=${database}`,"postgres:15-alpine"]); started=true;
    const port=Number(run("docker",["inspect","--format",'{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}',name])); assert.ok(port>1024);
    let ready=false;for(let i=0;i<120;i++){const p=spawnSync("docker",["exec",name,"pg_isready","-U",user,"-d",database],{env,stdio:"ignore"});if(p.status===0){ready=true;break;}await new Promise(r=>setTimeout(r,250));} assert.ok(ready);
    const url=`postgresql://${user}:${password}@127.0.0.1:${port}/${database}?schema=public`;
    const sql=(input)=>run("docker",["exec","-i",name,"psql","-v","ON_ERROR_STOP=1","-X","-U",user,"-d",database,"-At"],{input});
    const migrationDir=resolve(directory,"migrations");mkdirSync(migrationDir);
    const sourceDir=resolve(root,"packages/database/prisma/migrations");
    const names=readdirSync(sourceDir).filter(n=>/^\d{14}_/.test(n)).sort();assert.ok(names.includes(stageBoundary));assert.ok(names.includes(recoveryBoundary));assert.ok(names.includes(productionBoundary));
    cpSync(resolve(sourceDir,"migration_lock.toml"),resolve(migrationDir,"migration_lock.toml"));
    const schema=resolve(directory,"schema.prisma");writeFileSync(schema,readFileSync(resolve(root,"packages/database/prisma/schema.prisma")));
    const prismaCli=require.resolve("../packages/database/node_modules/prisma/build/index.js");
    const migrate=()=>run(process.execPath,[prismaCli,"migrate","deploy","--schema",schema],{env:{PATH:process.env.PATH,DATABASE_URL:url,PRISMA_HIDE_UPDATE_MESSAGE:"1",PRISMA_GENERATE_SKIP_AUTOINSTALL:"1"}});
    for(const name of names.filter(n=>n<=stageBoundary))cpSync(resolve(sourceDir,name),resolve(migrationDir,name),{recursive:true});
    migrate();
    sql(`INSERT INTO "VaultSparkObservation" ("id","payloadDigest","machineId","kind","sparkTransactionId","nayaxMachineId","hwSerial","amountCents","currency","verdict") VALUES ('${legacyId}','${"a".repeat(64)}','${randomUUID()}','TRANSACTION','${randomUUID()}','80000000','SYNTHETIC-LEGACY',2500,'USD','Approved');`);
    const before=sql(`SELECT "payloadDigest"||'|'||"amountCents"||'|'||"verdict" FROM "VaultSparkObservation" WHERE "id"='${legacyId}';`);
    for(const name of names.filter(n=>n>stageBoundary))cpSync(resolve(sourceDir,name),resolve(migrationDir,name),{recursive:true});
    migrate();
    assert.equal(sql(`SELECT "payloadDigest"||'|'||"amountCents"||'|'||"verdict" FROM "VaultSparkObservation" WHERE "id"='${legacyId}';`),before,"Legacy immutable payment facts survive upgrade");
    assert.equal(sql(`SELECT "methodClassification"||'|'||"methodProfileDigest"||'|'||"methodEvidence"::text||'|'||("receiptSequence">0)::text FROM "VaultSparkObservation" WHERE "id"='${legacyId}';`),`AMBIGUOUS|${"0".repeat(64)}|{}|true`,"Legacy rows gain no acquisition authority");
    assert.equal(sql(`SELECT "id"||'|'||"stage"||'|'||("paymentBindingDigest" IS NULL)::text FROM "VaultSparkObservation" WHERE "id"='${legacyId}';`),`${legacyId}|SANDBOX|true`,"Every historical receipt retains its original identity and becomes sandbox without production authority");
    // These rows exist only in this new task-owned disposable database. Same
    // machine/session/provider identities must never blend receipt domains or generations.
    const probeMachine=randomUUID(),probeSession=randomUUID(),productionBinding="b".repeat(64),olderBinding="c".repeat(64);
    const insertStage=(stage,id,paymentBindingDigest)=>`INSERT INTO "VaultSparkObservation" ("id","payloadDigest","machineId","kind","sparkTransactionId","nayaxMachineId","hwSerial","amountCents","currency","verdict","stage","paymentBindingDigest") VALUES ('${id}','${"d".repeat(64)}','${probeMachine}','TRANSACTION','${probeSession}','80000001','SYNTHETIC-STAGE',2500,'USD','Approved','${stage}',${paymentBindingDigest===null?"NULL":`'${paymentBindingDigest}'`});`;
    const productionId=`spark-production:${"1".repeat(64)}`,olderId=`spark-production:${"2".repeat(64)}`,sandboxId=`spark-sandbox:${"1".repeat(64)}`;
    sql(insertStage("PRODUCTION",productionId,productionBinding));
    sql(insertStage("PRODUCTION",olderId,olderBinding));
    sql(insertStage("SANDBOX",sandboxId,null));
    assert.equal(sql(`SELECT "id" FROM "VaultSparkObservation" WHERE "machineId"='${probeMachine}' AND "sparkTransactionId"='${probeSession}' AND "stage"='PRODUCTION' AND "paymentBindingDigest"='${productionBinding}';`),productionId,"Production session query selects only the exact stored generation");
    assert.equal(sql(`SELECT "id" FROM "VaultSparkObservation" WHERE "machineId"='${probeMachine}' AND "stage"='PRODUCTION' AND "paymentBindingDigest"='${olderBinding}' AND "receiptSequence">0 ORDER BY "receiptSequence";`),olderId,"Original production generation remains readable without entering another journal feed");
    assert.equal(sql(`SELECT "id" FROM "VaultSparkObservation" WHERE "machineId"='${probeMachine}' AND "stage"='SANDBOX' AND "receiptSequence">0 ORDER BY "receiptSequence";`),sandboxId,"Historical sandbox receipt feed cannot see production with the same identity");
    const invalidStages=[
      ["PRODUCTION",`spark-production:${"3".repeat(64)}`,null],
      ["PRODUCTION",`spark-production:${"4".repeat(64)}`,"malformed"],
      ["PRODUCTION",`spark-sandbox:${"5".repeat(64)}`,productionBinding],
      ["SANDBOX",`spark-production:${"6".repeat(64)}`,null],
      ["SANDBOX",`spark-sandbox:${"7".repeat(64)}`,productionBinding],
      ["LIVE",`spark-production:${"8".repeat(64)}`,productionBinding],
    ];
    for(const [stage,id,binding] of invalidStages)assert.throws(()=>sql(insertStage(stage,id,binding)),/VaultSparkObservation_stage_binding_check/,"Database rejects malformed or cross-stage receipt identity");
    assert.equal(sql(`SELECT count(*) FROM "VaultSparkObservation" WHERE "machineId"='${probeMachine}';`),"3","Rejected receipts leave no partial durable rows");
    assert.equal(Number(sql('SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;')),names.length);
    const second=migrate();assert.match(second,/No pending migrations to apply/);
    const report={check:"disposable-postgres-migration",migrationCount:names.length,migrationsDigest:createHash("sha256").update(names.map(migration=>`${migration}:${createHash("sha256").update(readFileSync(resolve(sourceDir,migration,"migration.sql"))).digest("hex")}`).join("\n")).digest("hex"),legacyEvidencePreserved:true,legacyClassification:"AMBIGUOUS",legacyStage:"SANDBOX",productionStageIsolation:true,productionBindingIsolation:true,stageConstraintRejections:invalidStages.length,secondDeploy:"NO_OP",loopback:true,tmpfs:true};
    console.log(JSON.stringify(report));
    return {url,close,sql,name,report,migrationCount:names.length};
  } catch(error){await close();throw error;}
}
