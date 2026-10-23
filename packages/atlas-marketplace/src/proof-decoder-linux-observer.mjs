import {Socket} from 'node:net';
import {constants,openSync,closeSync,fstatSync,readSync,lstatSync,realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,isAbsolute,normalize} from 'node:path';

const fail=code=>{const error=new Error(code);error.code=code;throw error;};
const check=(condition,code='DECODER_LINUX_OBSERVER_INVALID')=>{if(!condition)fail(code);};
const observers=new WeakSet();
let loadedArtifact=null;

/** Loads privileged code only after its protected artifact checks. Raw methods
 * exist for the target harness; they grant no decoder/service authority. */
export function loadProofDecoderLinuxPrimitives({enabled=false,addonPath,addonSha256}={}) {
  if(enabled!==true)return null;
  check(process.platform==='linux'&&process.arch==='x64'&&process.versions.node==='22.16.0','DECODER_LINUX_TARGET');
  check(typeof addonPath==='string'&&isAbsolute(addonPath)&&normalize(addonPath)===addonPath&&addonPath.endsWith('.node'));
  check(typeof addonSha256==='string'&&/^[a-f0-9]{64}$/.test(addonSha256));
  // This artifact is privileged code. Every ancestor and the file must be
  // root-owned and protected from group/world writers. Load the exact open inode.
  let parent=dirname(addonPath);
  while(true){const stat=lstatSync(parent);check(stat.isDirectory()&&!stat.isSymbolicLink()&&stat.uid===0&&(stat.mode&0o022)===0&&realpathSync(parent)===parent,'DECODER_NATIVE_ARTIFACT');if(parent==='/')break;parent=dirname(parent);}
  const fd=openSync(addonPath,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_CLOEXEC|constants.O_NONBLOCK);
  let binding,retained=false;
  try {
    const before=fstatSync(fd);check(before.isFile()&&before.uid===0&&before.nlink===1&&(before.mode&0o7022)===0&&before.size>0&&before.size<=1048576,'DECODER_NATIVE_ARTIFACT');
    const beforeNs=fstatSync(fd,{bigint:true});
    const buffer=Buffer.alloc(before.size+1);let used=0,count;
    while(used<buffer.length&&(count=readSync(fd,buffer,used,buffer.length-used,null))>0)used+=count;
    check(used===before.size&&createHash('sha256').update(buffer.subarray(0,used)).digest('hex')===addonSha256,'DECODER_NATIVE_ARTIFACT');
    const checked=fstatSync(fd,{bigint:true});check(beforeNs.size===checked.size&&beforeNs.mtimeNs===checked.mtimeNs&&beforeNs.ctimeNs===checked.ctimeNs,'DECODER_NATIVE_ARTIFACT');
    if(loadedArtifact){check(loadedArtifact.sha256===addonSha256&&loadedArtifact.path===addonPath&&loadedArtifact.device===beforeNs.dev&&loadedArtifact.inode===beforeNs.ino,'DECODER_NATIVE_ARTIFACT');binding=loadedArtifact.binding;}
    else {const module={exports:{}};process.dlopen(module,`/proc/self/fd/${fd}`);binding=module.exports;}
    const after=fstatSync(fd,{bigint:true});check(beforeNs.size===after.size&&beforeNs.mtimeNs===after.mtimeNs&&beforeNs.ctimeNs===after.ctimeNs,'DECODER_NATIVE_ARTIFACT');
    check(['capture','inspect','close','boottimeNanoseconds'].every(key=>typeof binding[key]==='function'),'DECODER_NATIVE_ARTIFACT');
    // Retain one artifact descriptor for process lifetime. Its /proc fd path
    // cannot be recycled into a different library by a later factory call.
    if(!loadedArtifact){loadedArtifact={sha256:addonSha256,path:addonPath,device:after.dev,inode:after.ino,binding,fd};retained=true;}
  } finally {if(!retained)closeSync(fd);}
  return Object.freeze(binding);
}

/** Actual Linux primitives, still UNQUALIFIED. No admission or service authority. */
export function createProofDecoderLinuxObserver(options={}) {
  const binding=loadProofDecoderLinuxPrimitives(options);if(binding===null)return null;
  const addonSha256=options.addonSha256;
  let closed=false;const peers=new Set();
  const observer=Object.freeze({classification:'UNQUALIFIED',evidenceOrigin:'LINUX_KERNEL',addonSha256,
    boottimeNanoseconds(){check(!closed,'DECODER_OBSERVER_CLOSED');const value=binding.boottimeNanoseconds();check(typeof value==='bigint'&&value>=0n,'DECODER_NATIVE_CLOCK');return value;},
    capture(socket,{uid,gid,pid}={}) {
      check(!closed&&peers.size<32,'DECODER_OBSERVER_UNAVAILABLE');
      check(socket instanceof Socket&&!socket.destroyed&&socket._handle&&Number.isSafeInteger(socket._handle.fd)&&socket._handle.fd>=0,'DECODER_NATIVE_SOCKET');
      check(Number.isSafeInteger(uid)&&uid>=0&&uid<=2147483647&&Number.isSafeInteger(gid)&&gid>=0&&gid<=2147483647&&(pid===undefined||Number.isSafeInteger(pid)&&pid>0),'DECODER_PEER_EXPECTATION');
      const native=binding.capture(socket._handle.fd);let ended=false;
      const release=()=>{if(!ended){ended=true;binding.close(native);peers.delete(peer);socket.off('close',release);}};
      const status=()=>{const value=binding.inspect(native);return Object.freeze({...value,alive:!ended&&!closed&&!socket.destroyed&&value.processAlive&&value.socketDescriptorMatches});};
      const peer=Object.freeze({classification:'UNQUALIFIED',evidenceOrigin:'LINUX_KERNEL',status,close:release,
        assertAlive(){const value=status();check(value.alive&&value.uid===uid&&value.gid===gid&&(pid===undefined||value.pid===pid),'DECODER_PEER_UNAVAILABLE');return value;}});
      try{peer.assertAlive();peers.add(peer);socket.once('close',release);return peer;}catch(error){release();throw error;}
    },
    close(){if(!closed){closed=true;for(const peer of [...peers])peer.close();}}
  });observers.add(observer);return observer;
}
export function assertProofDecoderLinuxObserver(value) {check(observers.has(value),'DECODER_LINUX_OBSERVER_REQUIRED');return value;}
