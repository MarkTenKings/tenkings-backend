import {readSync,openSync,closeSync,fstatSync,constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {canonicalJSON,requireValue} from '../src/contract.mjs';
import {decoderExact,decoderFreeze} from '../src/proof-decoder-profile.mjs';
import {engineDataOptions,parseProofDecoderEngineJSON} from '../src/proof-decoder-engine-json.mjs';

// These are observed public artifacts, not admission or kernel-enforcement claims.
export const PROOF_DECODER_SECURITY_PINS=decoderFreeze({
  inventorySha256:'01a90b96ce11e1914cc8c2888160b10c4f59734aba48320cdf5c481a3067d74f',
  nativeObservationSha256:'cbc6e94b5797caec113ccc42ed081a7a9cc51680f17a18aa9a42947fdfe2eb9e',
  parserVersion:'4.0.1',abiName:'4.0',abiSha256:'e510bb8f6788b45e48de2f859a6f94a7b8416cbac5a1051814cfce925fa911bd',
  image:'127.0.0.1:5001/atlas-r2-proof@sha256:2b497d3724e65ca2ae449072dada74b3197247649eaa2a8349b7d02d79609ac6',
  assets:{"security/proof-decoder/apparmor-v1.template":"18693c35ca04a468c574d6d869df50feb7e5c26f654e77021062ad838810c760","security/proof-decoder/limits-v1.json":"c3dc9bd2b67d825e875103fd8db79763aea10ef81cded4ad2eb1cc0b992939b7","security/proof-decoder/seccomp-linux-amd64-v1.json":"5f179abeafd17a18dbb6d0617fbda4a980d9b941e984b270f438ffdaebf47ede"}
});
const MARKERS=Object.freeze({classification:'PROPOSED_UNAPPLIED_UNQUALIFIED',executionAllowed:false,freshPublicationAllowed:false});
const check=(value,code='DECODER_SECURITY_ARTIFACT_INVALID')=>requireValue(value,code);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const NODE='opt/atlas-proof-decoder/bin/node';
const MAPPED=Object.freeze([
  'lib/x86_64-linux-gnu/ld-linux-x86-64.so.2','lib/x86_64-linux-gnu/libc.so.6','lib/x86_64-linux-gnu/libdl.so.2','lib/x86_64-linux-gnu/libgcc_s.so.1','lib/x86_64-linux-gnu/libm.so.6','lib/x86_64-linux-gnu/libpthread.so.0','lib/x86_64-linux-gnu/libresolv.so.2','lib/x86_64-linux-gnu/libstdc++.so.6','lib64/ld-linux-x86-64.so.2',NODE,
  'opt/atlas-proof-decoder/node_modules/@img/sharp-libvips-linux-x64/lib/libvips-cpp.so.42',
  'opt/atlas-proof-decoder/node_modules/@img/sharp-linux-x64/lib/sharp-linux-x64.node'
]);
function sourceAsset(name){
  let fd;
  try{
    fd=openSync(new URL('../'+name,import.meta.url),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    const before=fstatSync(fd);check(before.isFile()&&before.nlink===1&&before.size>0&&before.size<=65536);
    const storage=Buffer.alloc(before.size+1);let count=0;while(count<storage.length){const read=readSync(fd,storage,count,storage.length-count,count);if(read===0)break;count+=read;}const bytes=storage.subarray(0,count),after=fstatSync(fd);
    check(before.dev===after.dev&&before.ino===after.ino&&before.size===after.size&&bytes.length===before.size&&hash(bytes)===PROOF_DECODER_SECURITY_PINS.assets[name],'DECODER_SECURITY_SOURCE_PIN');return bytes;
  }finally{if(fd!==undefined)closeSync(fd);}
}
function canonicalAsset(name){const bytes=sourceAsset(name),value=parseProofDecoderEngineJSON(bytes,{maxBytes:65536});check(Buffer.from(canonicalJSON(value)+'\n').equals(bytes));return {bytes,value};}
function inventoryRules(bytes){
  const value=parseProofDecoderEngineJSON(bytes,{maxBytes:65536});decoderExact(value,['schema','platform','nativeObservationSha256','native','files','symlinks']);
  check(value.schema==='atlas-proof-decoder-rootfs-inventory-v1'&&value.platform==='linux/amd64'&&value.nativeObservationSha256===PROOF_DECODER_SECURITY_PINS.nativeObservationSha256&&Array.isArray(value.files)&&value.files.length===145&&Array.isArray(value.native)&&value.native.length===9&&Array.isArray(value.symlinks)&&value.symlinks.length===0);
  const names=new Set(),directories=new Set(['/']);let previous='';
  for(const entry of value.files){
    decoderExact(entry,['path','sha256','size','mode']);const path=entry.path;
    check(typeof path==='string'&&/^[A-Za-z0-9_@+./-]+$/.test(path)&&path.length<=256&&!path.startsWith('/')&&!path.endsWith('/')&&path.split('/').every(part=>part!==''&&part!=='.'&&part!=='..')&&path>previous&&!names.has(path));
    check(/^[a-f0-9]{64}$/.test(entry.sha256)&&Number.isSafeInteger(entry.size)&&entry.size>0&&[0o644,0o755].includes(entry.mode));previous=path;names.add(path);
    const parts=path.split('/');for(let at=1;at<parts.length;at++)directories.add('/'+parts.slice(0,at).join('/')+'/');
  }
  check(MAPPED.every(path=>names.has(path))&&value.native.every(entry=>MAPPED.includes(entry.path)));
  const lines=[...directories].sort().map(path=>'  "'+path+'" r,');
  for(const entry of value.files)lines.push('  "'+('/'+entry.path)+'" '+(entry.path===NODE?'rmix':MAPPED.includes(entry.path)?'rm':'r')+',');
  return {text:lines.join('\n'),fileCount:names.size,mappedFileCount:MAPPED.length,directoryCount:directories.size};
}
/** Render fixed candidate bytes only. Inputs are copied and hash-bound before
 * parsing. No profiles are loaded, no endpoints are opened, and no capability
 * or private runtime brand is returned. Caller owns the returned byte buffers. */
export function renderProofDecoderSecurityArtifacts(options){
  const {inventoryBytes,abiBytes}=engineDataOptions(options,['inventoryBytes','abiBytes']);
  check(Buffer.isBuffer(inventoryBytes)&&inventoryBytes.length===32877&&Buffer.isBuffer(abiBytes)&&abiBytes.length===2205,'DECODER_SECURITY_INPUT');
  const inventory=Buffer.from(inventoryBytes),abi=Buffer.from(abiBytes);
  check(hash(inventory)===PROOF_DECODER_SECURITY_PINS.inventorySha256&&hash(abi)===PROOF_DECODER_SECURITY_PINS.abiSha256,'DECODER_SECURITY_INPUT_PIN');
  const {bytes:seccompBytes,value:seccomp}=canonicalAsset('security/proof-decoder/seccomp-linux-amd64-v1.json');
  check(seccomp.defaultAction==='SCMP_ACT_ERRNO'&&seccomp.defaultErrnoRet===1&&canonicalJSON(seccomp.architectures)==='["SCMP_ARCH_X86_64"]');
  const {bytes:limitsBytes,value:limits}=canonicalAsset('security/proof-decoder/limits-v1.json');
  check(limits.image===PROOF_DECODER_SECURITY_PINS.image&&limits.classification===MARKERS.classification&&limits.executionAllowed===false&&limits.freshPublicationAllowed===false);
  const templateBytes=sourceAsset('security/proof-decoder/apparmor-v1.template'),template=templateBytes.toString('utf8'),rules=inventoryRules(inventory);
  check(template.endsWith('\n')&&!template.includes('\r')&&template.split('@@INVENTORY_RULES@@').length===2&&template.split('@@NAME@@').length===3);
  const expanded=template.replace('@@INVENTORY_RULES@@',rules.text),policyTemplateSha256=hash(Buffer.from(expanded));
  const profileName='atlas_r2_decoder_'+policyTemplateSha256;
  const apparmorBytes=Buffer.from(expanded.replaceAll('@@NAME@@',profileName));check(!apparmorBytes.includes(Buffer.from('@@'))&&apparmorBytes.length<=65536);
  const receipt=decoderFreeze({schema:'atlas-proof-decoder-security-artifacts-v1',...MARKERS,platform:'linux/amd64',image:limits.image,inventorySha256:PROOF_DECODER_SECURITY_PINS.inventorySha256,nativeObservationSha256:PROOF_DECODER_SECURITY_PINS.nativeObservationSha256,sourcePins:PROOF_DECODER_SECURITY_PINS.assets,seccompSha256:hash(seccompBytes),limitsSha256:hash(limitsBytes),apparmor:{profileName,templateSha256:hash(templateBytes),expandedTemplateSha256:policyTemplateSha256,renderedSha256:hash(apparmorBytes),parserVersion:PROOF_DECODER_SECURITY_PINS.parserVersion,abiName:PROOF_DECODER_SECURITY_PINS.abiName,abiSha256:hash(abi),mode:'enforce',flags:['mediate_deleted'],hostSupervisorLabel:'unconfined',workerLabelObserved:false,brokerLabelObserved:false},inventoryRules:{fileCount:rules.fileCount,mappedFileCount:rules.mappedFileCount,directoryCount:rules.directoryCount},kernelApplied:false,functionalWorkerTested:false,hostileControlsTested:false,runtimeQualified:false});
  return Object.freeze({...MARKERS,seccompBytes,apparmorBytes,abiBytes:abi,limitsBytes,limits:decoderFreeze(limits),receipt});
}
