#!/usr/bin/env node
// Fixed isolated-target service entry point. No credential lookup or arbitrary
// command/path dispatch. The runtime source/config must be root protected.
import {constants,openSync,closeSync,fstatSync,readSync,lstatSync,realpathSync,writeFileSync,fsyncSync,existsSync} from 'node:fs';
import {dirname} from 'node:path';
import {canonicalJSON} from '../src/contract.mjs';
import {decoderExact} from '../src/proof-decoder-profile.mjs';
import {parseProofDecoderEngineJSON} from '../src/proof-decoder-engine-json.mjs';
import {createProofDecoderLinuxObserver,loadProofDecoderLinuxPrimitives} from '../src/proof-decoder-linux-observer.mjs';
import {createProofDecoderLinuxCgroupController} from '../src/proof-decoder-linux-cgroup.mjs';
import {startProofDecoderKernelGuard} from '../src/proof-decoder-kernel-guard.mjs';

const CONFIG='/etc/atlas-r2-decoder/guard.json',STATE='/var/lib/atlas-r2-decoder-guard',LATCH=STATE+'/quarantine.json';
const check=value=>{if(!value)throw new Error('DECODER_GUARD_SERVICE_REFUSED');};
function directories(path){for(let current=path;;current=dirname(current)){const st=lstatSync(current);check(st.isDirectory()&&!st.isSymbolicLink()&&st.uid===0&&(st.mode&0o022)===0&&realpathSync(current)===current);if(current==='/')break;}}
function configuration(){
  directories(dirname(CONFIG));const fd=openSync(CONFIG,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK|constants.O_CLOEXEC);
  try{const st=fstatSync(fd);check(st.isFile()&&st.uid===0&&st.nlink===1&&(st.mode&0o7777)===0o600&&st.size>0&&st.size<=65536);const bytes=Buffer.alloc(st.size+1);let at=0,count;while(at<bytes.length&&(count=readSync(fd,bytes,at,bytes.length-at,null))>0)at+=count;check(at===st.size);const config=parseProofDecoderEngineJSON(bytes.subarray(0,at),{maxBytes:65536});decoderExact(config,['schema','addonPath','addonSha256','expectedBootId','plan','epoch']);check(config.schema==='atlas-proof-decoder-guard-service-v1');return config;}finally{closeSync(fd);}
}
function latch(controller){
  directories(STATE);check((lstatSync(STATE).mode&0o7777)===0o700);
  let fd;try{fd=openSync(LATCH,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW|constants.O_CLOEXEC,0o600);
    writeFileSync(fd,canonicalJSON({schema:'atlas-proof-decoder-guard-quarantine-v1',reason:'GUARD_STOP',bootId:controller.status().bootId,parentBindingHash:controller.status().bindingHash,observedAtNs:String(controller.boottimeNanoseconds())})+'\n');fsyncSync(fd);
  }catch(error){if(error.code!=='EEXIST')throw error;}finally{if(fd!==undefined)closeSync(fd);}
  const directory=openSync(STATE,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW|constants.O_CLOEXEC);try{fsyncSync(directory);}finally{closeSync(directory);}
}

let controller,guard,observer,timer,terminating=false;
function stop(){
  if(terminating)return;terminating=true;clearInterval(timer);
  try{if(controller)latch(controller);}catch{}
  try{controller?.freezeAndKill();}catch{}
  try{guard?.close();}catch{}
  observer?.close();controller?.close();process.stderr.write('DECODER_GUARD_STOPPED_QUARANTINED\n');process.exit(1);
}
try{
  check(process.getuid()===0&&process.argv.length===3&&['start','quarantine'].includes(process.argv[2]));
  const config=configuration(),options={enabled:true,addonPath:config.addonPath,addonSha256:config.addonSha256,expectedBootId:config.expectedBootId};
  controller=createProofDecoderLinuxCgroupController(options);
  if(process.argv[2]==='quarantine'){
    let failed=false;try{latch(controller);}catch{failed=true;}
    try{controller.freezeAndKill();}catch{failed=true;}controller.close();process.exit(failed?1:0);
  }
  directories(STATE);check(!existsSync(LATCH));
  observer=createProofDecoderLinuxObserver(options);
  guard=await startProofDecoderKernelGuard({enabled:true,controller,observer,plan:config.plan,epoch:config.epoch});
  const native=loadProofDecoderLinuxPrimitives(options);check(typeof native.notifySupervisor==='function');
  native.notifySupervisor('ready');
  timer=setInterval(()=>{try{guard.assertHealthy();native.notifySupervisor('watchdog');}catch{stop();}},100);
  process.on('SIGTERM',stop);process.on('SIGINT',stop);process.on('uncaughtException',stop);process.on('unhandledRejection',stop);
}catch{stop();}
