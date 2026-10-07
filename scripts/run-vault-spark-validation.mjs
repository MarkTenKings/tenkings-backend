import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { startDisposableSparkPostgres } from "./vault-disposable-spark-postgres.mjs";
import { vaultNextTestEnvironment } from "./vault-next-test-server.mjs";
const root=resolve(import.meta.dirname,"..");
const evidence=resolve(process.env.VAULT_SPARK_EVIDENCE_DIR??"outputs/vault-spark-integration");
const database=await startDisposableSparkPostgres();
process.env.AI_GRADER_NFC_DISPOSABLE_VALIDATION="1";
const environment={...vaultNextTestEnvironment(database.url),AI_GRADER_NFC_DISPOSABLE_VALIDATION:"1",VAULT_SYNTHETIC_SPARK_VALIDATION:"1",VAULT_SPARK_EVIDENCE_DIR:evidence,...(process.env.HOME?{HOME:process.env.HOME}:{}),...(process.env.PLAYWRIGHT_BROWSERS_PATH?{PLAYWRIGHT_BROWSERS_PATH:process.env.PLAYWRIGHT_BROWSERS_PATH}:{})};
async function run(script,args=[]){const child=spawn(process.execPath,[resolve(root,script),...args],{cwd:root,env:environment,stdio:"inherit"});const code=await new Promise((done,reject)=>{child.once("error",reject);child.once("exit",done);});assert.equal(code,0,`${script} must pass`);}
try {
  mkdirSync(evidence,{recursive:true});writeFileSync(resolve(evidence,"migration-evidence.json"),JSON.stringify(database.report,null,2)+"\n");
  // Existing canonical projections still run on the exact migrated database.
  for(const count of [null,72,125,256])await run("scripts/validate-vault-postgres.mjs",count?[`--profile-doors=${count}`]:[]);
  await run("scripts/validate-vault-spark-integration.mjs");
} finally {await database.close();}
