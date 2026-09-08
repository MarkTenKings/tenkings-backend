import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, mkdir, writeFile, readFile, chmod, readdir, lstat, rm, symlink, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { writeOperatorArtifact, verifyOperatorArtifact, packageOperatorRelease, releaseCanonical as canonical, releaseDigest as digest,
    artifactPath, assertClosedNative, FIXED_NODE_VERSION, PRISMA_ROOT, BOOTSTRAP_PATH, VERIFIER_PATH, RUNTIME_PATH, CLIENT_PATH, NODE_PATH } from '../src/release-artifact.mjs';
import { packageArguments, packageMain } from '../scripts/package-release.mjs';
function native(dependencies=['/usr/lib/libSystem.B.dylib'],{arch='arm64',command=0xc}={}) {
    const commands=dependencies.map(name=>{const size=Math.ceil((24+Buffer.byteLength(name)+1)/8)*8,bytes=Buffer.alloc(size);
        bytes.writeUInt32LE(command,0);bytes.writeUInt32LE(size,4);bytes.writeUInt32LE(24,8);bytes.write(name,24);return bytes;});
    const header=Buffer.alloc(32);header.writeUInt32LE(0xfeedfacf,0);header.writeUInt32LE(arch==='arm64'?0x0100000c:0x01000007,4);
    header.writeUInt32LE(commands.length,16);header.writeUInt32LE(commands.reduce((n,b)=>n+b.length,0),20);return Buffer.concat([header,...commands]);
}
const engine=`${PRISMA_ROOT}/libquery_engine-darwin-arm64.dylib.node`;
const sources=['packages/atlas-operator/src/runtime.mjs','packages/atlas-operator/src/ledger.mjs','packages/atlas-operator/src/provider.mjs',
    'packages/atlas-operator/src/adapters.mjs','packages/atlas-service-bridge/src/operator-evidence.mjs','packages/atlas-service-bridge/src/machine-initialize-transport.mjs','packages/atlas-grading-core/dist/report.js'];
async function cleanup(path){
    const stat=await lstat(path);if(stat.isSymbolicLink()||!stat.isDirectory())return rm(path,{force:true});
    await chmod(path,0o700);for(const name of await readdir(path))await cleanup(join(path,name));await rm(path,{recursive:true,force:true});
}
async function folder(work){const root=await realpath(await mkdtemp(join(tmpdir(),'atlas-release-unit-')));try{return await work(root);}finally{await cleanup(root);}}
function files(){
    const result=new Map();
    for(const path of [BOOTSTRAP_PATH,VERIFIER_PATH,RUNTIME_PATH,NODE_PATH,CLIENT_PATH,`${PRISMA_ROOT}/package.json`,`${PRISMA_ROOT}/runtime/library.js`,`${PRISMA_ROOT}/schema.prisma`,engine])
        result.set(path,{bytes:Buffer.from(`synthetic immutable bytes ${path}`),executable:path===NODE_PATH||path===engine});
    result.get(NODE_PATH).bytes=native();result.get(engine).bytes=native();
    const closure={version:'atlas-operator-closure-v1',bundler:'esbuild@0.27.7',entry:sources[0],runtimeHash:digest(result.get(RUNTIME_PATH).bytes),
        inputs:sources.map(path=>({path,sha256:digest(path)})),external:['node:crypto']};
    result.set('closure.json',{bytes:Buffer.from(canonical(closure))});return result;
}
async function fixture(parent){
    const input=files(),executablePath=join(parent,'synthetic-node');await writeFile(executablePath,input.get(NODE_PATH).bytes);
    const artifact=await writeOperatorArtifact({root:join(parent,'artifact'),files:input,platform:'darwin',arch:'arm64',prismaEngine:engine});
    const options={nodeVersion:FIXED_NODE_VERSION,platform:'darwin',arch:'arm64',executablePath};
    return {input,artifact,options,verify:(changes={})=>verifyOperatorArtifact({root:artifact.root,expectedBuildHash:artifact.buildHash}, {...options,...changes})};
}
async function mutate(path,bytes){await chmod(path,0o644);await writeFile(path,bytes);await chmod(path,0o444);}

test('inventory and build hash are reproducible across roots and unrelated mtimes',()=>folder(async root=>{
    const f=await fixture(root), second=await writeOperatorArtifact({root:join(root,'second'),files:files(),platform:'darwin',arch:'arm64',prismaEngine:engine});
    assert.equal(f.artifact.buildHash,second.buildHash);assert.deepEqual(await readFile(join(f.artifact.root,'artifact.json')),await readFile(join(second.root,'artifact.json')));
    const verified=await f.verify();assert.equal(verified.enginePath,join(f.artifact.root,engine));assert.equal(verified.clientPath,join(f.artifact.root,CLIENT_PATH));
    assert.equal(verified.buildHash,f.artifact.buildHash);assert.equal(verified.nodeVersion,FIXED_NODE_VERSION);
}));
test('runtime, verifier, native engine and generated Prisma substitutions fail against independent build identity',()=>folder(async root=>{
    for(const [n,path] of [RUNTIME_PATH,VERIFIER_PATH,engine,CLIENT_PATH,`${PRISMA_ROOT}/schema.prisma`].entries()){
        const parent=join(root,`case${n}`);await mkdir(parent);const f=await fixture(parent);
        await mutate(join(f.artifact.root,path),Buffer.from('changed mutable code'));
        await assert.rejects(()=>f.verify(),/ASTRA_ARTIFACT_CHANGED/);
    }
}));
test('unlisted executable code and writable inventory content fail closed',()=>folder(async root=>{
    const f=await fixture(root),path=join(f.artifact.root,'runtime');await chmod(path,0o755);
    await writeFile(join(path,'injected.mjs'),'throw Error("must not load")',{mode:0o444});await chmod(path,0o555);
    await assert.rejects(()=>f.verify(),/ASTRA_ARTIFACT_UNLISTED_FILE/);
    await chmod(join(f.artifact.root,CLIENT_PATH),0o644);await assert.rejects(()=>f.verify(),/ASTRA_ARTIFACT_FILE_UNSAFE/);
}));
test('symlink, hardlink and ancestor escape attempts are rejected without module import',()=>folder(async root=>{
    const f=await fixture(root),path=join(f.artifact.root,RUNTIME_PATH),parent=dirname(path),outside=join(root,'outside.mjs');
    await writeFile(outside,f.input.get(RUNTIME_PATH).bytes);await chmod(parent,0o755);await rm(path);await symlink(outside,path);await chmod(parent,0o555);
    await assert.rejects(()=>f.verify(),/ASTRA_ARTIFACT_FILE_UNSAFE/);
    await chmod(parent,0o755);await rm(path);await link(outside,path);await chmod(path,0o444);await chmod(parent,0o555);
    await assert.rejects(()=>f.verify(),/ASTRA_ARTIFACT_FILE_UNSAFE/);
    const alias=join(root,'alias');await symlink(f.artifact.root,alias);await assert.rejects(()=>verifyOperatorArtifact({root:alias,expectedBuildHash:f.artifact.buildHash},f.options),/ASTRA_ARTIFACT_PATH_INVALID/);
}));
test('path traversal and missing required closure cannot be packaged',()=>folder(async root=>{
    for(const path of ['../escape.mjs','/absolute.mjs','a/../../b','a//b','a/./b','a\\b','file:///tmp/x','a/%2e%2e/x'])assert.throws(()=>artifactPath(path),/PATH_INVALID/);
    const incomplete=files();incomplete.delete(engine);
    await assert.rejects(()=>writeOperatorArtifact({root:join(root,'incomplete'),files:incomplete,platform:'darwin',arch:'arm64',prismaEngine:engine}),/CLOSURE_INCOMPLETE/);
    const escaped=files();escaped.set('../outside',{bytes:Buffer.from('must not write')});
    await assert.rejects(()=>writeOperatorArtifact({root:join(root,'escaped'),files:escaped,platform:'darwin',arch:'arm64',prismaEngine:engine}),/PATH_INVALID/);
    await assert.rejects(()=>lstat(join(root,'outside')),error=>error.code==='ENOENT');
}));
test('missing dependencies and external runtime imports fail even if attacker recomputes their inventory',()=>folder(async root=>{
    for(const kind of ['missing','external']){
        const input=files(),closure=JSON.parse(input.get('closure.json').bytes);
        if(kind==='missing')closure.inputs=closure.inputs.filter(row=>!row.path.endsWith('/operator-evidence.mjs'));
        else closure.external.push('@unlisted/mutable-code');
        input.set('closure.json',{bytes:Buffer.from(canonical(closure))});
        const artifact=await writeOperatorArtifact({root:join(root,kind),files:input,platform:'darwin',arch:'arm64',prismaEngine:engine});
        const executablePath=join(root,`${kind}-node`);await writeFile(executablePath,input.get(NODE_PATH).bytes);
        await assert.rejects(()=>verifyOperatorArtifact({root:artifact.root,expectedBuildHash:artifact.buildHash},
            {nodeVersion:FIXED_NODE_VERSION,platform:'darwin',arch:'arm64',executablePath}),/CLOSURE_INCOMPLETE/);
    }
}));
test('exact Node binary, version and platform are independently pinned',()=>folder(async root=>{
    const f=await fixture(root);
    for(const changes of [{nodeVersion:'v20.20.0'},{platform:'linux'},{arch:'x64'}])await assert.rejects(()=>f.verify(changes),/PLATFORM_CHANGED/);
    await writeFile(f.options.executablePath,'substituted executable with same reported version');await assert.rejects(()=>f.verify(),/NODE_BINARY_CHANGED/);
}));
test('existing output and symlinked output parent are never overwritten',()=>folder(async root=>{
    const f=await fixture(root);
    await assert.rejects(()=>writeOperatorArtifact({root:f.artifact.root,files:files(),platform:'darwin',arch:'arm64',prismaEngine:engine}),error=>error.code==='EEXIST');
    const alias=join(root,'alias');await symlink(root,alias);
    await assert.rejects(()=>writeOperatorArtifact({root:join(alias,'escape'),files:files(),platform:'darwin',arch:'arm64',prismaEngine:engine}),/PATH_INVALID/);
}));
async function producerFixture(root){
    const sourceRoot=join(root,'source');await mkdir(sourceRoot);
    const put=async(path,bytes)=>{const full=join(sourceRoot,path);await mkdir(dirname(full),{recursive:true});await writeFile(full,bytes);};
    for(const path of [BOOTSTRAP_PATH,VERIFIER_PATH,...sources])await put(path,`export const synthetic = ${JSON.stringify(path)};`);
    const schema='datasource db { provider = "postgresql" url = env("ATLAS_DATABASE_URL") }';
    const config={clientVersion:'5.22.0',generator:{config:{engineType:'library'}},relativeEnvPaths:{rootEnvPath:null},activeProvider:'postgresql',datasourceNames:['db'],
        inlineDatasources:{db:{url:{fromEnvVar:'ATLAS_DATABASE_URL',value:null}}},inlineSchema:schema};
    await put(CLIENT_PATH,`const config = ${JSON.stringify(config,null,2)}\n; path.join(__dirname, "libquery_engine-darwin-arm64.dylib.node")`);
    await put(`${PRISMA_ROOT}/package.json`,JSON.stringify({version:'5.22.0'}));await put(`${PRISMA_ROOT}/runtime/library.js`,'// synthetic pinned Prisma runtime');
    await put(`${PRISMA_ROOT}/schema.prisma`,schema);await put(engine,native());
    const executablePath=join(root,'synthetic-node');await writeFile(executablePath,native());
    const bindings={databaseBindingHash:'a'.repeat(64),providerBindingHash:'b'.repeat(64),imageBridge:{origin:'https://evidence.invalid',keyHash:'c'.repeat(64)},machineInitialization:null};
    const request={sourceRoot,outputRoot:join(root,'packaged'),releaseSha:'d'.repeat(40),bindings};
    const result={outputFiles:[{contents:Buffer.from('export const syntheticBundle = true;')}],
        metafile:{inputs:Object.fromEntries(sources.map(path=>[path,{}])),outputs:{[RUNTIME_PATH]:{entryPoint:sources[0],imports:[{external:true,path:'node:crypto'}]}}},
        sourceHashes:Object.fromEntries(await Promise.all(sources.map(async path=>[path,digest(await readFile(join(sourceRoot,path)))])))};
    const options={bundle:async()=>result,nodeVersion:FIXED_NODE_VERSION,platform:'darwin',arch:'arm64',executablePath};
    return {request,options,result,put};
}
test('producer binds code inventory into existing runtime manifest using only nonsecret deployment hashes',()=>folder(async root=>{
    const f=await producerFixture(root),result=await packageOperatorRelease(f.request,f.options);
    assert.equal(result.manifest.buildHash,result.buildHash);assert.equal(digest(result.manifestBytes),result.manifestHash);
    assert.equal(result.manifest.runtimeHash,digest(canonical({version:'atlas-operator-runtime-v1',mode:'PRODUCTION',releaseSha:f.request.releaseSha,
        buildHash:result.buildHash,providerBindingHash:f.request.bindings.providerBindingHash,databaseBindingHash:f.request.bindings.databaseBindingHash})));
    assert(!result.manifestBytes.includes('password'));assert.equal(result.manifest.model,'gpt-6-astra');
    await verifyOperatorArtifact({root:result.root,expectedBuildHash:result.buildHash},f.options);
}));
test('producer rejects incomplete graphs, unlisted dependencies, changed inputs, credentials and unavailable engine targets',()=>folder(async root=>{
    for(const [n,change] of [
        f=>{delete f.result.metafile.inputs[sources[1]];},
        f=>{f.result.metafile.outputs[RUNTIME_PATH].imports.push({external:true,path:'unlisted-module'});},
        f=>{f.result.sourceHashes[sources[0]]='f'.repeat(64);},
        f=>{f.request.bindings.databaseUrl='postgresql://secret:secret@private.invalid/db';},
        f=>{f.options.arch='x64';},
    ].entries()){
        const path=join(root,`case${n}`);await mkdir(path);const f=await producerFixture(path);change(f);
        await assert.rejects(()=>packageOperatorRelease(f.request,f.options));
    }
}));
test('package CLI exposes only explicit input/output bindings and never supports activation or provider secrets',async()=>{
    const args=['--source-root','/source','--output','/artifact','--bindings','/bindings.json','--bindings-sha256','a'.repeat(64),'--release-sha','b'.repeat(40),'--manifest-out','/manifest.json'];
    assert.equal(packageArguments(args)['--output'],'/artifact');
    for(const bad of [[...args,'--enable'],args.map(value=>value==='--bindings'?'--api-key':value),args.map(value=>value==='/manifest.json'?'/artifact/manifest.json':value)])assert.throws(()=>packageArguments(bad));
    for(const key of ['NODE_OPTIONS','OPENSSL_CONF','OPENSSL_MODULES','OPENSSL_ENGINES','SSL_CERT_FILE','SSL_CERT_DIR']) {
        // Injected objects only: never ask Node/OpenSSL to load a real file.
        for(const value of ['', '/synthetic/unopened-override']) {
            let calls=0;const result=await packageMain(args,{[key]:value},{execArgv:[],produce:async()=>{calls++;}});
            assert.equal(result.code,'ASTRA_RELEASE_PROCESS_UNSAFE',key);assert.equal(calls,0);
        }
    }
});


test('native parser rejects Homebrew linkage, loader indirection, malformed binaries and architecture changes',()=>{
    assert.deepEqual(assertClosedNative(native(),{platform:'darwin',arch:'arm64'}),['/usr/lib/libSystem.B.dylib']);
    // An engine's LC_ID_DYLIB build-host name is not an external dependency.
    assert.deepEqual(assertClosedNative(native(['/Users/runner/build/engine.dylib'],{command:0xd}),{platform:'darwin',arch:'arm64'}),[]);
    for(const path of ['/opt/homebrew/opt/openssl/lib/libssl.dylib','@rpath/libevil.dylib','/usr/lib/../local/libevil.dylib'])
        assert.throws(()=>assertClosedNative(native([path]),{platform:'darwin',arch:'arm64'}),/NATIVE_DEPENDENCY_UNCLOSED/);
    for(const [bytes,options] of [[Buffer.from('not a binary'),{platform:'darwin',arch:'arm64'}],[native(),{platform:'linux',arch:'arm64'}],
        [native(),{platform:'darwin',arch:'x64'}]])assert.throws(()=>assertClosedNative(bytes,options),/NATIVE_DEPENDENCY_UNCLOSED/);
});


test('generated inline datasource credentials and schema substitutions cannot enter a release',()=>folder(async root=>{
    for(const [n,change] of [text=>text.replace('"value": null','"value": "postgresql://secret:secret@db.invalid/private"'),
        text=>text.replace('"rootEnvPath": null','"rootEnvPath": "/private/secret.env"')].entries()){
        const path=join(root,`case${n}`);await mkdir(path);const f=await producerFixture(path);
        await f.put(CLIENT_PATH,change(await readFile(join(f.request.sourceRoot,CLIENT_PATH),'utf8')));
        await assert.rejects(()=>packageOperatorRelease(f.request,f.options),/ASTRA_PRISMA_CLIENT_CHANGED/);
    }
}));


test('manifest v2 fills only the actual final runtime hash into the execution-only initialization binding',()=>folder(async root=>{
    const f=await producerFixture(root);
    f.request.bindings.machineInitialization={origin:'https://initialize.invalid',admissionKeyHash:'e'.repeat(64),executionKeyHash:'f'.repeat(64)};
    const result=await packageOperatorRelease(f.request,f.options);
    assert.equal(result.manifest.version,'atlas-operator-release-v2');assert.deepEqual(result.manifest.machineInitialization,
        {...f.request.bindings.machineInitialization,runtimeHash:result.manifest.runtimeHash});
    assert(!Object.hasOwn(result.manifest.machineInitialization,'admissionKey'));assert(!Object.hasOwn(result.manifest.machineInitialization,'executionKey'));
}));
test('producer rejects an admission secret, caller runtime hash or reused purpose key in initialization bindings',()=>folder(async root=>{
    for(const [n,change] of [value=>({...value,admissionKey:'secret'}),value=>({...value,runtimeHash:'a'.repeat(64)}),
        value=>({...value,executionKeyHash:value.admissionKeyHash}),value=>({...value,origin:'https://user:password@initialize.invalid'})].entries()){
        const path=join(root,`case${n}`);await mkdir(path);const f=await producerFixture(path);
        f.request.bindings.machineInitialization=change({origin:'https://initialize.invalid',admissionKeyHash:'e'.repeat(64),executionKeyHash:'f'.repeat(64)});
        await assert.rejects(()=>packageOperatorRelease(f.request,f.options));
    }
}));
