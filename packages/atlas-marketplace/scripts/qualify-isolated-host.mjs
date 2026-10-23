import {constants} from 'node:fs';
import {lstat,open,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,isAbsolute,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const fail=code=>{const error=new Error(code);error.code=code;throw error;};
const safeCode=error=>/^[A-Z0-9_]{1,100}$/.test(error?.code??'')?error.code:'ISOLATED_QUALIFICATION_FAILED';

// No environment discovery, provider credentials or production configuration.
// The fixture runner is imported only after explicit arguments and a new private
// receipt destination have been validated. The integration exercise owns cleanup.
export async function runIsolatedHostQualificationCli(argv, {signal}={}) {
  if(argv.length===0)return {schema:'atlas-r2-isolated-host-cli-v1',status:'DISABLED',productionReady:false};
  const allowed=new Set(['--pg-module','--postgres-bin','--receipt']),values={};
  if(argv[0]!=='--enable-synthetic-host-qualification')fail('EXPLICIT_SYNTHETIC_ENABLE_REQUIRED');
  for(let index=1;index<argv.length;index+=2){
    const key=argv[index],value=argv[index+1];
    if(!allowed.has(key)||Object.hasOwn(values,key)||typeof value!=='string'||!isAbsolute(value)||value.includes('\0'))fail('INVALID_QUALIFICATION_ARGUMENTS');
    values[key]=value;
  }
  if(Object.keys(values).length!==3)fail('EXPLICIT_QUALIFICATION_PATHS_REQUIRED');
  const parent=dirname(values['--receipt']),info=await lstat(parent);
  if(!info.isDirectory()||info.isSymbolicLink()||info.uid!==process.getuid?.()||(info.mode&0o077)!==0||await realpath(parent)!==parent)fail('PRIVATE_RECEIPT_DIRECTORY_REQUIRED');
  if(signal?.aborted)fail('ISOLATED_QUALIFICATION_ABORTED');
  const destination=await open(values['--receipt'],constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  let receipt,error;
  try {
    const {qualifyIsolatedHostRunner}=await import('../test/isolated-host-runner.integration.mjs');
    receipt=await qualifyIsolatedHostRunner({pgModulePath:values['--pg-module'],postgresBin:values['--postgres-bin'],signal});
  }catch(caught){
    error=caught;
    receipt={schema:'atlas-r2-isolated-host-cli-v1',status:'FAILED',code:safeCode(caught),productionReady:false,
      // The qualification exercise may attach its own redacted cleanup receipt.
      ...(caught?.qualificationReceipt?{qualification:caught.qualificationReceipt}:{})};
  }
  try {await destination.writeFile(JSON.stringify(receipt,null,2)+'\n');await destination.sync();}
  finally {await destination.close();}
  if(error)throw error;
  return {schema:'atlas-r2-isolated-host-cli-v1',status:receipt.status,receipt:values['--receipt'],
    receiptSha256:createHash('sha256').update(JSON.stringify(receipt,null,2)+'\n').digest('hex'),productionReady:false};
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const controller=new AbortController(),abort=()=>controller.abort();
  process.on('SIGINT',abort);process.on('SIGTERM',abort);
  try {console.log(JSON.stringify(await runIsolatedHostQualificationCli(process.argv.slice(2),{signal:controller.signal})));}
  catch(error){console.error(JSON.stringify({status:'FAILED',code:safeCode(error),productionReady:false}));process.exitCode=1;}
  finally {process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);}
}
