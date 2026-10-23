import {createHash} from 'node:crypto';
import {engineDataOptions} from './proof-decoder-engine-json.mjs';
import {assertProofDecoderLaunchPlan,decoderFreeze,PROOF_DECODER_IMAGE_LAYOUT} from './proof-decoder-profile.mjs';

const check=(ok,code='DECODER_KERNEL_INPUT_CONTROLS')=>{if(!ok)throw Object.assign(new Error(code),{code});};
const text=(value,max)=>{check(typeof value==='string'&&Buffer.byteLength(value)<=max);return value;};
const integer=(value,min,max)=>{check(Number.isSafeInteger(value)&&value>=min&&value<=max);return value;};
const nsNames=['pid','ipc','net','mnt','cgroup','user'];
const filePaths=new Set(['worker.mjs','contract.mjs','proof-decoder-protocol.mjs','proof-decoder-worker-protocol.mjs','proof-image-decode.mjs'].map(name=>'/opt/atlas-proof-decoder/'+name));
function rows(value,max){check(Array.isArray(value)&&value.length>0&&value.length<=max);const d=Object.getOwnPropertyDescriptors(value);check(Reflect.ownKeys(d).length===value.length+1);return Array.from({length:value.length},(_,i)=>{check(Object.hasOwn(d,i)&&Object.hasOwn(d[i],'value'));return d[i].value;});}
function fields(raw,max){const result={};for(const line of text(raw,max).trimEnd().split('\n')){const at=line.indexOf(':');check(at>0);const key=line.slice(0,at);check(/^[A-Za-z_0-9]+$/.test(key)&&!Object.hasOwn(result,key));result[key]=line.slice(at+1).trim();}return result;}
function namespaces(value){const out=engineDataOptions(value,nsNames);for(const name of nsNames)check(typeof out[name]==='string'&&new RegExp('^'+name+':\\[[1-9][0-9]{0,19}\\]$').test(out[name]));return out;}
function numberList(value,max=32){check(typeof value==='string'&&/^[0-9]+(?:[ \t]+[0-9]+)*$/.test(value));return value.split(/\s+/).map(x=>integer(Number(x),0,2147483647)).map((x,i,a)=>{check(a.length<=max);return x;});}
const setOf=(value)=>{check(typeof value==='string'&&/^[A-Za-z0-9_=/,:.-]+$/.test(value));const a=value.split(',');check(new Set(a).size===a.length);return new Set(a);};
const has=(set,...keys)=>keys.every(key=>set.has(key));
function optionValue(set,name){const found=[...set].filter(x=>x.startsWith(name+'='));check(found.length===1);return found[0].slice(name.length+1);}
function size(value){check(/^[1-9][0-9]*(?:k|m|g)?$/.test(value));const units={k:1024,m:1048576,g:1073741824};const suffix=value.at(-1),scale=units[suffix]??1;const n=Number(scale===1?value:value.slice(0,-1))*scale;return integer(n,1,Number.MAX_SAFE_INTEGER);}
function reviewMounts(raw,profile,id){
  const mounts=new Map(),ids=new Set();const lines=text(raw,65535).trimEnd().split('\n');check(lines.length>0&&lines.length<=64);
  for(const line of lines){const a=line.split(' '),dash=a.indexOf('-');check(dash===6&&a.length===10&&/^[1-9][0-9]*$/.test(a[0])&&/^[1-9][0-9]*$/.test(a[1])&&/^\d+:\d+$/.test(a[2]));
    check(!ids.has(a[0])&&!mounts.has(a[4])&&a[3].startsWith('/')&&a[4].startsWith('/')&&!line.includes('\\'));ids.add(a[0]);mounts.set(a[4],{id:a[0],parent:a[1],device:a[2],root:a[3],options:setOf(a[5]),type:a[7],source:a[8],super:setOf(a[9])});}
  const required=['/','/proc','/dev','/dev/pts','/sys','/sys/fs/cgroup','/dev/mqueue','/dev/shm','/tmp','/etc/hostname','/etc/hosts','/etc/resolv.conf','/proc/bus','/proc/fs','/proc/irq','/proc/sys','/proc/sysrq-trigger','/proc/acpi','/proc/interrupts','/proc/kcore','/proc/keys','/proc/latency_stats','/proc/scsi','/proc/timer_list','/sys/firmware'];
  check(mounts.size===required.length&&required.every(x=>mounts.has(x)));
  for(const [path,m] of mounts){check(!(m.options.has('rw')&&m.options.has('ro'))&&(m.options.has('ro')||m.options.has('rw')));if(path!=='/')check(ids.has(m.parent));}
  function need(path,type,root,...flags){const m=mounts.get(path);check(m.type===type&&m.root===root&&has(m.options,...flags));return m;}
  const root=need('/','overlay','/','ro');check(root.source==='overlay');
  need('/proc','proc','/','rw','nosuid','nodev','noexec');const dev=need('/dev','tmpfs','/','rw','nosuid');
  need('/dev/pts','devpts','/','rw','nosuid','noexec');need('/sys','sysfs','/','ro','nosuid','nodev','noexec');
  need('/sys/fs/cgroup','cgroup2',`/atlasdecoder.slice/docker-${id}.scope`,'ro','nosuid','nodev','noexec');need('/dev/mqueue','mqueue','/','rw','nosuid','nodev','noexec');
  const tmp=need('/tmp','tmpfs','/','rw','nosuid','nodev','noexec'),shm=need('/dev/shm','tmpfs','/','rw','nosuid','nodev','noexec');
  check(size(optionValue(tmp.super,'size'))===profile.resources.tmpfsBytes&&size(optionValue(shm.super,'size'))===profile.resources.shmBytes);
  check(optionValue(tmp.super,'uid')===String(profile.uid)&&optionValue(tmp.super,'gid')===String(profile.gid)&&optionValue(tmp.super,'mode')==='700');
  for(const name of ['hostname','hosts','resolv.conf'])need('/etc/'+name,'ext4',`/var/lib/docker/containers/${id}/${name}`,'ro');
  for(const name of ['bus','fs','irq','sys','sysrq-trigger']){const m=need('/proc/'+name,'proc','/'+name,'ro','nosuid','nodev','noexec');check(m.device===mounts.get('/proc').device);}
  for(const path of ['/proc/acpi','/proc/scsi','/sys/firmware']){const m=need(path,'tmpfs','/','ro');check(size(optionValue(m.super,'size'))===4096);}
  for(const name of ['interrupts','kcore','keys','latency_stats','timer_list']){const m=need('/proc/'+name,'tmpfs','/null','rw','nosuid');check(m.device===dev.device);}
  return mounts.size;
}
function reviewFds(value,profile){
  const list=rows(value,64),numbers=new Set();check(list.length<=profile.resources.nofileLimit);
  for(const item of list){const f=engineDataOptions(item,['number','target','info','mode','uid','gid','device','inode','mountId','rootMatches']);integer(f.number,0,profile.resources.nofileLimit-1);check(!numbers.has(f.number));numbers.add(f.number);text(f.target,4095);integer(f.mode,0,0xffff);integer(f.uid,0,4294967295);integer(f.gid,0,4294967295);check([f.device,f.inode,f.mountId].every(x=>typeof x==='string'&&/^[0-9]{1,20}$/.test(x))&&typeof f.rootMatches==='boolean');
    const lines=text(f.info,4095).trimEnd().split('\n');check(lines.length<=64);const matches=lines.filter(line=>line.startsWith('flags:'));check(matches.length===1);for(const [field,expected] of [['ino',f.inode],['mnt_id',f.mountId]]){const hits=lines.filter(line=>line.startsWith(field+':'));check(hits.length===1&&hits[0].slice(field.length+1).trim()===expected);}
    const rawFlags=matches[0].slice(6).trim();check(/^[0-7]{1,12}$/.test(rawFlags));const flags=BigInt('0o'+rawFlags),access=flags&3n,type=f.mode&0o170000;
    if(f.number<=2){check(type===0o010000&&/^pipe:\[[1-9][0-9]*\]$/.test(f.target)&&access===BigInt(f.number===0?0:1));continue;}
    check((flags&0o2000000n)!==0n); // All non-stdio descriptors must close on exec.
    if(type===0o010000){check(/^pipe:\[[1-9][0-9]*\]$/.test(f.target)&&(access===0n||access===1n));continue;}
    if(f.target==='anon_inode:[eventpoll]'||f.target==='anon_inode:[eventfd]'){check(type===0&&access===2n);continue;}
    if(f.target==='/dev/null'){check(type===0o020000&&f.rootMatches&&(access===0n||access===2n));continue;}
    check(filePaths.has(f.target)&&type===0o100000&&access===0n&&f.rootMatches&&f.uid===0&&f.gid===0&&(f.mode&0o7777)===0o644);
  }
  check([0,1,2].every(n=>numbers.has(n)));return list.length;
}

/** Pure, UNQUALIFIED interpretation for focused tests and review. It never
 * brands observations. Only the concrete controller can hold native handles. */
export function reviewProofDecoderKernelWorkerControls(options){
  const {snapshot,plan:rawPlan,pid,containerId}=engineDataOptions(options,['snapshot','plan','pid','containerId']);
  const plan=assertProofDecoderLaunchPlan(rawPlan),p=plan.profile;integer(pid,2,2147483647);check(typeof containerId==='string'&&/^[a-f0-9]{64}$/.test(containerId));
  check(p.platform==='linux/amd64'&&p.nodeVersion==='22.16.0'&&p.mac.kind==='apparmor'&&p.limits.maxConcurrent===1&&p.resources.pidsLimit<=32&&p.resources.nofileLimit<=64);
  const s=engineDataOptions(snapshot,['executable','command','mountinfo','limits','network','hostNamespaces','resources','tasks','fds']);
  check(s.executable===PROOF_DECODER_IMAGE_LAYOUT.node&&s.command===[PROOF_DECODER_IMAGE_LAYOUT.node,'--max-old-space-size=128',PROOF_DECODER_IMAGE_LAYOUT.worker,''].join('\0'));
  const host=namespaces(s.hostNamespaces),tasks=rows(s.tasks,32),tids=new Set();check(tasks.length<=p.resources.pidsLimit);let leader;
  for(const item of tasks){const t=engineDataOptions(item,['tid','status','apparmor','namespaces']);integer(t.tid,2,2147483647);check(!tids.has(t.tid));tids.add(t.tid);const f=fields(t.status,8191),ns=namespaces(t.namespaces);
    check(Number(f.Pid)===t.tid&&Number(f.Tgid)===pid&&f.TracerPid==='0'&&/^[RS] \(.+\)$/.test(f.State));
    for(const [key,expected] of [['Uid',p.uid],['Gid',p.gid]]){const values=numberList(f[key],4);check(values.length===4&&values.every(v=>v===expected));}
    check(f.Groups===''||numberList(f.Groups,32).every(v=>v===p.gid));
    for(const name of ['CapInh','CapPrm','CapEff','CapBnd','CapAmb'])check(f[name]==='0000000000000000');
    check(f.NoNewPrivs==='1'&&f.Seccomp==='2'&&f.Seccomp_filters==='1'&&text(t.apparmor,255).trim()===p.mac.name+' (enforce)');
    const nspid=numberList(f.NSpid,2);check(nspid.length===2&&nspid[0]===t.tid&&nspid[1]>0&&(t.tid===pid?nspid[1]===1:nspid[1]>1));
    for(const name of nsNames.slice(0,5))check(ns[name]!==host[name]);
    if(t.tid===pid)leader={...t,namespaces:ns};
  }
  check(leader);for(const t of tasks)for(const name of nsNames)check(t.namespaces[name]===leader.namespaces[name]);
  const r=engineDataOptions(s.resources,['memory.max','memory.swap.max','cpu.max','pids.max','pids.current','memory.events','cgroup.procs']);
  for(const value of Object.values(r))text(value,4095);
  check(r['memory.max']===p.resources.memoryBytes+'\n'&&r['memory.swap.max']==='0\n'&&r['cpu.max']===p.resources.cpuQuotaMicros+' '+p.resources.cpuPeriodMicros+'\n'&&r['pids.max']===p.resources.pidsLimit+'\n');
  check(/^[1-9][0-9]*\n$/.test(r['pids.current'])&&Number(r['pids.current'])>=tasks.length&&Number(r['pids.current'])<=p.resources.pidsLimit&&r['cgroup.procs']===pid+'\n');
  const events=new Map();for(const line of text(r['memory.events'],4095).trimEnd().split('\n')){const [name,value,...rest]=line.split(' ');check(rest.length===0&&/^[a-z_]+$/.test(name)&&/^\d+$/.test(value)&&!events.has(name));events.set(name,value);}check(['oom','oom_kill','oom_group_kill'].every(k=>events.get(k)==='0'));
  const limits=text(s.limits,8191).split('\n');for(const [name,value,unit] of [['Max open files',p.resources.nofileLimit,'files'],['Max core file size',0,'bytes']]){const matching=limits.filter(x=>x.startsWith(name+' '));check(matching.length===1&&matching[0].trim().split(/\s{2,}/).join('|')===[name,value,value,unit].join('|'));}
  const network=text(s.network,8191).trimEnd().split('\n');check(network.length===3&&network[0].includes('Inter-')&&network[1].includes('face'));
  const iface=network[2].trim().split(/\s+/);check(iface[0]==='lo:'&&iface.length===17&&iface.slice(1).every(x=>/^\d+$/.test(x)));
  const mountCount=reviewMounts(s.mountinfo,p,containerId),fdCount=reviewFds(s.fds,p);
  return decoderFreeze({schema:'atlas-proof-decoder-worker-controls-review-v1',classification:'UNQUALIFIED',executionAllowed:false,freshPublicationAllowed:false,profileHash:plan.profileHash,containerId,pid,taskCount:tasks.length,fdCount,mountCount,seccompMode:2,seccompFilters:1,installedSeccompBytesVerified:false,userNamespaceIsolated:leader.namespaces.user!==host.user,mountinfoSha256:createHash('sha256').update(s.mountinfo).digest('hex')});
}
