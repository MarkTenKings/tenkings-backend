#!/usr/bin/env node
// Explicit target-only primitive harness. No Docker, worker, qualification grant,
// production target discovery or inherited configuration.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,chmodSync,rmSync,openSync,closeSync,symlinkSync} from 'node:fs';
import {createProofDecoderLinuxObserver,assertProofDecoderLinuxObserver,loadProofDecoderLinuxPrimitives} from '../src/proof-decoder-linux-observer.mjs';

const [addonPath,addonSha256]=process.argv.slice(2);
assert.equal(process.argv.length,4);
assert.equal(process.platform,'linux');assert.equal(process.getuid(),0);
const options={enabled:true,addonPath,addonSha256};
const binding=loadProofDecoderLinuxPrimitives(options);

test('default off and forged observers refuse without granting authority',()=>{
  assert.equal(createProofDecoderLinuxObserver(),null);
  assert.throws(()=>assertProofDecoderLinuxObserver({classification:'UNQUALIFIED'}),{code:'DECODER_LINUX_OBSERVER_REQUIRED'});
  assert.throws(()=>createProofDecoderLinuxObserver({...options,addonSha256:'0'.repeat(64)}),{code:'DECODER_NATIVE_ARTIFACT'});
});

test('invalid hash, symlink and FIFO refuse before any native initialization',{timeout:2000},()=>{
  const directory=mkdtempSync('/run/atlas-r2-loader-test-');let loads=0;const original=process.dlopen;
  process.dlopen=()=>{loads++;throw new Error('unexpected native initialization');};
  try {
    assert.throws(()=>loadProofDecoderLinuxPrimitives({...options,addonSha256:'0'.repeat(64)}),{code:'DECODER_NATIVE_ARTIFACT'});
    const link=directory+'/alias.node';symlinkSync(addonPath,link);
    assert.throws(()=>loadProofDecoderLinuxPrimitives({...options,addonPath:link}));
    const fifo=directory+'/fifo.node';assert.equal(spawnSync('/usr/bin/mkfifo',[fifo],{env:{PATH:'/usr/bin:/bin',LC_ALL:'C'},timeout:500}).status,0);
    assert.throws(()=>loadProofDecoderLinuxPrimitives({...options,addonPath:fifo}),{code:'DECODER_NATIVE_ARTIFACT'});
    assert.equal(loads,0);
  } finally {process.dlopen=original;rmSync(directory,{recursive:true,force:true});}
});

test('native API refuses foreign values, invalid descriptors and non-sockets',()=>{
  for(const value of [-1,0.5,NaN,Infinity,2147483648,'1',{},null])assert.throws(()=>binding.capture(value));
  assert.throws(()=>binding.capture());assert.throws(()=>binding.capture(0,1));
  assert.throws(()=>binding.inspect({}));assert.throws(()=>binding.close({}));
  assert.throws(()=>binding.boottimeNanoseconds(1));
  const fd=openSync('/dev/null','r');try{assert.throws(()=>binding.capture(fd),{code:'DECODER_NATIVE_SOCKET'});}finally{closeSync(fd);}
});

test('actual suspend-aware clock increases and observer close is final',()=>{
  const observer=createProofDecoderLinuxObserver(options);
  assert.equal(observer.classification,'UNQUALIFIED');assert.equal(observer.evidenceOrigin,'LINUX_KERNEL');
  const first=observer.boottimeNanoseconds();const second=observer.boottimeNanoseconds();
  assert.equal(typeof first,'bigint');assert.ok(second>=first);
  observer.close();observer.close();assert.throws(()=>observer.boottimeNanoseconds(),{code:'DECODER_OBSERVER_CLOSED'});
});

for(const uid of [0,65534])test(`actual Unix peer credentials and pidfd lifecycle for uid ${uid}`,{timeout:6000},async()=>{
  const directory=mkdtempSync('/run/atlas-r2-native-test-');chmodSync(directory,0o755);
  const path=directory+'/peer.sock';const server=createServer({allowHalfOpen:true});
  const observer=createProofDecoderLinuxObserver(options);let child,socket,peer;
  try {
    server.listen(path);await once(server,'listening');chmodSync(path,0o666);
    const accepted=once(server,'connection');
    child=spawn(process.execPath,['-e',`const net=require('node:net');const socket=net.connect(process.argv[1]);socket.on('error',()=>process.exit(2));socket.on('data',()=>{socket.end();process.exit(0)});setTimeout(()=>process.exit(3),4000);`,path],{
      uid,gid:uid,env:{PATH:'/usr/bin:/bin',LC_ALL:'C'},stdio:'ignore'
    });
    const exited=once(child,'exit');
    [socket]=await accepted;socket.on('error',()=>{});
    assert.throws(()=>observer.capture(socket,{uid:uid===0?65534:0,gid:uid,pid:child.pid}),{code:'DECODER_PEER_UNAVAILABLE'});
    peer=observer.capture(socket,{uid,gid:uid,pid:child.pid});
    assert.deepEqual(peer.assertAlive(),{pid:child.pid,uid,gid:uid,processAlive:true,socketDescriptorMatches:true,closed:false,alive:true});
    const token=binding.capture(socket._handle.fd);
    try {
      assert.equal(binding.inspect(token).processAlive,true);
      socket.write('x');const [code,signal]=await exited;assert.equal(code,0);assert.equal(signal,null);
      assert.equal(binding.inspect(token).processAlive,false);
      assert.equal(peer.status().alive,false);assert.throws(()=>peer.assertAlive(),{code:'DECODER_PEER_UNAVAILABLE'});
      binding.close(token);binding.close(token);assert.equal(binding.inspect(token).closed,true);
    } finally {binding.close(token);}
  } finally {
    peer?.close();observer.close();socket?.destroy();
    if(child&&child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill('SIGKILL');await exited;}
    if(server.listening)await new Promise(resolve=>server.close(resolve));
    rmSync(directory,{recursive:true,force:true});
  }
});
