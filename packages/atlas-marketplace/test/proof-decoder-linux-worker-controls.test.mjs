import test from 'node:test';
import assert from 'node:assert/strict';
import {createProofDecoderLaunchPlan} from '../src/proof-decoder-profile.mjs';
import {syntheticDecoderProfile} from './proof-decoder-profile-fixtures.mjs';
import {reviewProofDecoderKernelWorkerControls as review} from '../src/proof-decoder-linux-worker-controls.mjs';
import {createProofDecoderLinuxCgroupController} from '../src/proof-decoder-linux-cgroup.mjs';

// Invented data exercises only closed interpretation, never the native producer.
function fixture(){
  const profile=syntheticDecoderProfile();profile.limits.maxConcurrent=1;
  const plan=createProofDecoderLaunchPlan({enabled:true,profile}),pid=101,containerId='9'.repeat(64),p=plan.profile;
  const hostNamespaces=Object.fromEntries(['pid','ipc','net','mnt','cgroup','user'].map((name,i)=>[name,`${name}:[${10+i}]`]));
  const namespaces=Object.fromEntries(Object.entries(hostNamespaces).map(([name,value])=>[name,name==='user'?value:`${name}:[${100+Object.keys(hostNamespaces).indexOf(name)}]`]));
  const status=`Name:\tnode\nState:\tS (sleeping)\nTgid:\t${pid}\nPid:\t${pid}\nTracerPid:\t0\nUid:\t${Array(4).fill(p.uid).join('\t')}\nGid:\t${Array(4).fill(p.gid).join('\t')}\nGroups:\t\nNSpid:\t${pid}\t1\n${['CapInh','CapPrm','CapEff','CapBnd','CapAmb'].map(k=>k+':\t0000000000000000').join('\n')}\nNoNewPrivs:\t1\nSeccomp:\t2\nSeccomp_filters:\t1\n`;
  const mount=[];let id=1;
  function add(path,type,root='/',options='ro,nosuid,nodev,noexec',superOptions='ro',device='0:3'){mount.push(`${id++} 1 ${device} ${root} ${path} ${options} - ${type} ${type} ${superOptions}`);}
  add('/','overlay','/','ro','rw,lowerdir=/synthetic/a:/synthetic/b,upperdir=/synthetic/c,workdir=/synthetic/d');
  add('/proc','proc','/','rw,nosuid,nodev,noexec','rw','0:4');add('/dev','tmpfs','/','rw,nosuid','rw,size=65536k','0:5');add('/dev/pts','devpts','/','rw,nosuid,noexec','rw');add('/sys','sysfs');add('/sys/fs/cgroup','cgroup2',`/atlasdecoder.slice/docker-${containerId}.scope`);add('/dev/mqueue','mqueue','/','rw,nosuid,nodev,noexec','rw');
  add('/dev/shm','tmpfs','/','rw,nosuid,nodev,noexec',`rw,size=${p.resources.shmBytes}`);add('/tmp','tmpfs','/','rw,nosuid,nodev,noexec',`rw,size=${p.resources.tmpfsBytes},mode=700,uid=${p.uid},gid=${p.gid}`);
  for(const name of ['hostname','hosts','resolv.conf'])add('/etc/'+name,'ext4',`/var/lib/docker/containers/${containerId}/${name}`,'ro,relatime','rw');
  for(const name of ['bus','fs','irq','sys','sysrq-trigger'])add('/proc/'+name,'proc','/'+name,'ro,nosuid,nodev,noexec','rw','0:4');
  for(const path of ['/proc/acpi','/proc/scsi','/sys/firmware'])add(path,'tmpfs','/','ro','ro,size=4k');
  for(const name of ['interrupts','kcore','keys','latency_stats','timer_list'])add('/proc/'+name,'tmpfs','/null','rw,nosuid','rw','0:5');
  const fds=[0,1,2].map(number=>({number,target:`pipe:[${number+1000}]`,info:`pos:\t0\nflags:\t0${number===0?'0':'1'}\nmnt_id:\t1\nino:\t${number+1000}\n`,mode:0o010600,uid:p.uid,gid:p.gid,device:'15',inode:String(number+1000),mountId:'1',rootMatches:false}));
  fds.push({number:3,target:'anon_inode:[eventpoll]',info:'pos:\t0\nflags:\t02000002\nmnt_id:\t18\nino:\t1\ntfd: 0 events: 19 data: 1\ntfd: 1 events: 19 data: 2\n',mode:0o600,uid:p.uid,gid:p.gid,device:'16',inode:'1',mountId:'18',rootMatches:false});
  const snapshot={executable:'/opt/atlas-proof-decoder/bin/node',command:'/opt/atlas-proof-decoder/bin/node\0--max-old-space-size=128\0/opt/atlas-proof-decoder/worker.mjs\0',mountinfo:mount.join('\n')+'\n',limits:`Limit  Soft Limit  Hard Limit  Units\nMax open files  ${p.resources.nofileLimit}  ${p.resources.nofileLimit}  files\nMax core file size  0  0  bytes\n`,network:'Inter-| Receive | Transmit\n face |bytes packets|bytes packets\nlo: '+Array(16).fill(0).join(' ')+'\n',hostNamespaces,resources:{'memory.max':p.resources.memoryBytes+'\n','memory.swap.max':'0\n','cpu.max':p.resources.cpuQuotaMicros+' '+p.resources.cpuPeriodMicros+'\n','pids.max':p.resources.pidsLimit+'\n','pids.current':'1\n','memory.events':'low 0\nhigh 0\nmax 0\noom 0\noom_kill 0\noom_group_kill 0\n','cgroup.procs':pid+'\n'},tasks:[{tid:pid,status,apparmor:p.mac.name+' (enforce)\n',namespaces}],fds};
  return {plan,pid,containerId,snapshot};
}
function rejects(change){const f=fixture();change(f);assert.throws(()=>review(f));}

test('pure control interpretation remains unqualified and cannot construct a native controller',()=>{
  const f=fixture(),result=review(f);assert.equal(result.classification,'UNQUALIFIED');assert.equal(result.executionAllowed,false);assert.equal(result.freshPublicationAllowed,false);assert.equal(result.installedSeccompBytesVerified,false);assert.equal(result.userNamespaceIsolated,false);assert.equal(result.mountCount,25);assert.ok(Object.isFrozen(result));assert.equal(createProofDecoderLinuxCgroupController(),null);
  assert.throws(()=>createProofDecoderLinuxCgroupController({enabled:true,addonPath:'/tmp/fake.node',addonSha256:'1'.repeat(64),expectedBootId:'invalid',snapshot:f.snapshot}));
});
test('each UID/GID, supplementary group, cap, no-new-privileges, seccomp and AppArmor mismatch refuses',()=>{
  for(const key of ['Uid','Gid'])rejects(f=>{f.snapshot.tasks[0].status=f.snapshot.tasks[0].status.replace(new RegExp(key+':[^\\n]+'),key+':\t0\t0\t0\t0');});
  for(const key of ['CapInh','CapPrm','CapEff','CapBnd','CapAmb'])rejects(f=>{f.snapshot.tasks[0].status=f.snapshot.tasks[0].status.replace(key+':\t0000000000000000',key+':\t0000000000000001');});
  for(const [a,b] of [['Groups:\t\n','Groups:\t0\n'],['NoNewPrivs:\t1','NoNewPrivs:\t0'],['Seccomp:\t2','Seccomp:\t0'],['Seccomp_filters:\t1','Seccomp_filters:\t2'],['TracerPid:\t0','TracerPid:\t99']])rejects(f=>{f.snapshot.tasks[0].status=f.snapshot.tasks[0].status.replace(a,b);});
  rejects(f=>{f.snapshot.tasks[0].apparmor='unconfined';});
});
test('private namespace and exact leader/executable/cmdline agreement are mandatory',()=>{
  for(const name of ['pid','ipc','net','mnt','cgroup'])rejects(f=>{f.snapshot.tasks[0].namespaces[name]=f.snapshot.hostNamespaces[name];});
  rejects(f=>{f.snapshot.tasks[0].status=f.snapshot.tasks[0].status.replace('NSpid:\t101\t1','NSpid:\t101\t2');});
  rejects(f=>{f.snapshot.executable='/runc';});rejects(f=>{f.snapshot.command+='injected\0';});
  rejects(f=>{f.snapshot.tasks.push({...f.snapshot.tasks[0]});});
});
test('mount policy refuses unknown/stacked/missing mounts, writable root and weakened temp controls',()=>{
  for(const [a,b] of [['/ / ro','/ / rw'],['/tmp rw,nosuid,nodev,noexec','/tmp rw,nosuid,nodev'],['/dev/shm rw,nosuid,nodev,noexec','/dev/shm rw,nosuid,noexec'],['mode=700','mode=777'],['/etc/hosts ro','/etc/hosts rw'],[' - overlay',' shared:5 - overlay']])rejects(f=>{assert.ok(f.snapshot.mountinfo.includes(a));f.snapshot.mountinfo=f.snapshot.mountinfo.replace(a,b);});
  rejects(f=>{f.snapshot.mountinfo+=f.snapshot.mountinfo.split('\n')[0]+'\n';});rejects(f=>{f.snapshot.mountinfo=f.snapshot.mountinfo.replace('/tmp ','/other ');});
  rejects(f=>{f.snapshot.mountinfo=f.snapshot.mountinfo.replace('size='+f.plan.profile.resources.shmBytes,'size=1');});
});
test('exact leaf resources, nofile/core limits, no OOM and single process are required',()=>{
  for(const key of ['memory.max','memory.swap.max','cpu.max','pids.max','pids.current'])rejects(f=>{f.snapshot.resources[key]='max\n';});
  rejects(f=>{f.snapshot.resources['cgroup.procs']+='102\n';});rejects(f=>{f.snapshot.resources['memory.events']=f.snapshot.resources['memory.events'].replace('oom_kill 0','oom_kill 1');});
  rejects(f=>{f.snapshot.limits=f.snapshot.limits.replace('Max core file size  0  0','Max core file size  0  1');});
  rejects(f=>{f.snapshot.network+='eth0: '+Array(16).fill(0).join(' ')+'\n';});
});
test('fd metadata refuses sockets, directories, foreign files, wrong access and non-CLOEXEC descriptors',()=>{
  for(const [target,mode] of [['socket:[9]',0o140600],['/run/docker.sock',0o140600],['/root/private',0o100600],['/tmp',0o040700]])rejects(f=>{Object.assign(f.snapshot.fds[3],{target,mode});});
  rejects(f=>{f.snapshot.fds[0].info='flags:\t01\n';});rejects(f=>{f.snapshot.fds[3].info='flags:\t02\n';});
  rejects(f=>{Object.assign(f.snapshot.fds[3],{target:'/opt/atlas-proof-decoder/worker.mjs',mode:0o100644,info:'flags:\t02000000\nmnt_id:\t18\nino:\t1\n',uid:0,gid:0,rootMatches:false});});
  const f=fixture();Object.assign(f.snapshot.fds[3],{target:'/opt/atlas-proof-decoder/worker.mjs',mode:0o100644,info:'flags:\t02000000\nmnt_id:\t18\nino:\t1\n',uid:0,gid:0,rootMatches:true});assert.equal(review(f).fdCount,4);
});
test('bounds, duplicate fields and accessor objects refuse without invoking getters',()=>{
  rejects(f=>{f.snapshot.mountinfo='a'.repeat(65536);});rejects(f=>{f.snapshot.tasks=Array(33).fill(f.snapshot.tasks[0]);});
  rejects(f=>{f.snapshot.tasks[0].status+='Seccomp:\t2\n';});rejects(f=>{f.snapshot.fds[0].info+='flags:\t00\n';});
  for(const key of ['inode','mountId'])rejects(f=>{f.snapshot.fds[3][key]='999';});
  let calls=0;const poison={toString(){calls++;return '101';}};
  for(const change of [f=>{f.containerId=poison;},f=>{f.snapshot.hostNamespaces.pid=poison;},f=>{f.snapshot.tasks[0].namespaces.pid=poison;},f=>{f.snapshot.fds[0].device=poison;},f=>{f.snapshot.fds[0].inode=poison;},f=>{f.snapshot.fds[0].mountId=poison;},f=>{f.snapshot.resources['pids.current']=poison;}])rejects(change);
  assert.equal(calls,0);const f=fixture();Object.defineProperty(f.snapshot,'fds',{enumerable:true,get(){calls++;return [];}});assert.throws(()=>review(f));assert.equal(calls,0);
});
