// The bootstrap imports only this module and Node builtins before verification.
// Producer-only code is unreachable from run.mjs; esbuild is loaded lazily only
// by the explicit offline package command, never by a serving/operator runtime.
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, lstat, readdir, realpath, mkdir, writeFile, chmod } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { builtinModules } from 'node:module';

export const FIXED_NODE_VERSION = 'v20.20.1';
export const SUPPORTED_NODE_VERSIONS = Object.freeze(['v20.20.1','v22.23.2']);
export const ARTIFACT_FILE = 'artifact.json';
export const BOOTSTRAP_PATH = 'packages/atlas-operator/scripts/run.mjs';
export const VERIFIER_PATH = 'packages/atlas-operator/src/release-artifact.mjs';
export const RUNTIME_PATH = 'runtime/operator.mjs';
export const PRISMA_ROOT = 'frontend/atlas-app/.generated/staff-database';
export const CLIENT_PATH = `${PRISMA_ROOT}/index.js`;
export const NODE_PATH = 'bin/node';
const SHA = /^[a-f0-9]{64}$/;
const LIMIT = 256 * 1024 * 1024, TOTAL_LIMIT = 512 * 1024 * 1024, FILE_LIMIT = 256;
const BUILTINS = new Set(builtinModules.flatMap(name => [name, `node:${name}`]));
const REQUIRED = [BOOTSTRAP_PATH, VERIFIER_PATH, RUNTIME_PATH, NODE_PATH, CLIENT_PATH,
    `${PRISMA_ROOT}/package.json`, `${PRISMA_ROOT}/runtime/library.js`, `${PRISMA_ROOT}/schema.prisma`, 'closure.json'];
export const releaseCheck = (condition, code = 'ASTRA_ARTIFACT_INVALID') => {
    if (!condition) throw Object.assign(new Error(code), { code });
};
export const releaseDigest = value => createHash('sha256').update(value).digest('hex');
export function releaseCanonical(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(releaseCanonical).join(',')}]`;
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${releaseCanonical(value[key])}`).join(',')}}`;
}
const exact = (value, names) => releaseCheck(value && typeof value === 'object' && !Array.isArray(value)
    && releaseCanonical(Object.keys(value).sort()) === releaseCanonical([...names].sort()));
export function artifactPath(value) {
    releaseCheck(typeof value === 'string' && value.length > 0 && value.length <= 240 && !isAbsolute(value)
        && /^[A-Za-z0-9_.@/-]+$/.test(value) && value.split('/').every(part => part && part !== '.' && part !== '..'), 'ASTRA_ARTIFACT_PATH_INVALID');
    return value;
}
const within = (root, path) => path === root || path.startsWith(`${root}${sep}`);

const LINUX_ENGINE = 'libquery_engine-debian-openssl-3.0.x.so.node';
const LINUX_INTERPRETER = '/lib64/ld-linux-x86-64.so.2';
const LINUX_DEPENDENCIES = Object.freeze({
    executable: ['libdl.so.2','libstdc++.so.6','libm.so.6','libgcc_s.so.1','libpthread.so.0','libc.so.6','ld-linux-x86-64.so.2'],
    library: ['libssl.so.3','libcrypto.so.3','libgcc_s.so.1','librt.so.1','libpthread.so.0','libm.so.6','libdl.so.2','libc.so.6','ld-linux-x86-64.so.2'],
});
const nativeTarget = ({nodeVersion,platform,arch}) => (platform==='darwin' && ['arm64','x64'].includes(arch)
    && SUPPORTED_NODE_VERSIONS.includes(nodeVersion)) || (platform==='linux' && arch==='x64' && nodeVersion===FIXED_NODE_VERSION);
const engineTarget = ({platform,arch}) => platform==='linux' ? LINUX_ENGINE : `libquery_engine-darwin${arch==='arm64'?'-arm64':''}.dylib.node`;

/** The ELF branch deliberately accepts only the reviewed Node 20 / Prisma 5.22
 * Debian OpenSSL 3 x64 load format. It is not a general ELF loader or an OS
 * integrity check: the immutable Debian container supplies the trusted loader
 * and system libraries. Nothing here invokes ldd, readelf or the input binary.
 */
function assertClosedElf(bytes,kind,fail) {
    fail(Buffer.isBuffer(bytes) && bytes.length>=64 && bytes.length<=LIMIT && ['executable','library'].includes(kind));
    fail(bytes.readUInt32LE(0)===0x464c457f && bytes[4]===2 && bytes[5]===1 && bytes[6]===1
        && [0,3].includes(bytes[7]) && bytes.subarray(8,16).every(value=>value===0));
    const uint64=offset=>{const value=bytes.readBigUInt64LE(offset);fail(value<=BigInt(Number.MAX_SAFE_INTEGER));return Number(value);};
    const sum=(a,b)=>{fail(Number.isSafeInteger(a+b));return a+b;};
    const range=(offset,length)=>{fail(offset>=0 && length>=0 && sum(offset,length)<=bytes.length);};
    const type=bytes.readUInt16LE(16), entry=uint64(24), phoff=uint64(32), shoff=uint64(40);
    const phnum=bytes.readUInt16LE(56), shnum=bytes.readUInt16LE(60), shstr=bytes.readUInt16LE(62);
    fail(type===(kind==='executable'?2:3) && bytes.readUInt16LE(18)===62 && bytes.readUInt32LE(20)===1
        && bytes.readUInt32LE(48)===0 && bytes.readUInt16LE(52)===64 && bytes.readUInt16LE(54)===56
        && phoff>=64 && phnum>0 && phnum<=128);
    range(phoff,phnum*56);
    // Extended/ambiguous table numbering is outside this fixed build format.
    if(shoff===0) fail(shnum===0 && shstr===0 && [0,64].includes(bytes.readUInt16LE(58)));
    else {fail(shoff>=64 && bytes.readUInt16LE(58)===64 && shnum>0 && shnum<=4096 && shstr<shnum);range(shoff,shnum*64);}
    const loads=[],dynamics=[],interpreters=[];let stackCount=0;
    const types=new Set([0,1,2,3,4,6,7,0x6474e550,0x6474e551,0x6474e552,0x6474e553]);
    for(let n=0;n<phnum;n++) {
        const p=phoff+n*56, tag=bytes.readUInt32LE(p), flags=bytes.readUInt32LE(p+4);
        const offset=uint64(p+8), address=uint64(p+16), physical=uint64(p+24), size=uint64(p+32), memory=uint64(p+40), align=uint64(p+48);
        fail(types.has(tag) && flags<=7 && size<=memory);range(offset,size);sum(address,memory);sum(physical,memory);
        fail(align===0 || (BigInt(align)&(BigInt(align)-1n))===0n);
        if(align>1) fail(offset%align===address%align);
        const segment={offset,address,size,memory,flags};
        if(tag===1) {
            fail(memory>0 && align>=4096 && align<=2*1024*1024 && (flags&3)!==3);
            // Do not let a second load remap even part of a page used to
            // resolve the dynamic/string table. These builds use 4 KiB pages.
            fail(!loads.length || Math.floor(address/4096)>=Math.ceil(sum(loads.at(-1).address,loads.at(-1).memory)/4096));
            loads.push(segment);
        }
        if(tag===2) dynamics.push(segment);
        if(tag===3) {fail(loads.length===0);interpreters.push(segment);}
        if(tag===0x6474e551) {stackCount++;fail(!(flags&1));}
    }
    fail(loads.length>0 && dynamics.length===1 && stackCount===1);
    const mapped=(address,size)=>{
        const end=sum(address,size), matches=loads.filter(load=>address>=load.address && end<=sum(load.address,load.size));
        fail(matches.length===1);const offset=sum(matches[0].offset,address-matches[0].address);range(offset,size);return offset;
    };
    if(kind==='executable') {
        fail(interpreters.length===1 && entry>0);
        const interp=interpreters[0], expected=Buffer.from(`${LINUX_INTERPRETER}\0`);
        fail(interp.size===expected.length && mapped(interp.address,interp.size)===interp.offset
            && bytes.subarray(interp.offset,interp.offset+interp.size).equals(expected));
    } else fail(interpreters.length===0);
    // The actual Prisma shared library has an entry point too; it must still
    // refer to executable file-backed bytes, never an unmapped/BSS address.
    if(entry) fail(loads.filter(load=>load.flags&1 && entry>=load.address && entry<sum(load.address,load.size)).length===1);
    const dynamic=dynamics[0];
    fail(dynamic.size>=16 && dynamic.size%16===0 && dynamic.size<=4096*16 && mapped(dynamic.address,dynamic.size)===dynamic.offset);
    const tags=new Map(), needed=[];
    // Unknown dynamic tags can introduce additional loader behavior. Only the
    // relocation/version/init metadata in the two reviewed binaries is admitted.
    const allowed=new Set([1,2,3,5,6,7,8,9,10,11,12,13,20,21,23,24,25,26,27,28,
        0x6ffffef5,0x6ffffff0,0x6ffffff9,0x6ffffffb,0x6ffffffe,0x6fffffff]);
    let ended=false;
    for(let offset=dynamic.offset;offset<dynamic.offset+dynamic.size;offset+=16) {
        const tag=uint64(offset),value=uint64(offset+8);
        if(ended || tag===0) {fail(tag===0 && value===0);ended=true;continue;}
        fail(allowed.has(tag));
        if(tag===1) {needed.push(value);fail(needed.length<=32);}
        else {fail(!tags.has(tag));tags.set(tag,value);}
    }
    fail(ended && needed.length>0 && tags.has(5) && tags.has(10) && tags.get(10)>0 && tags.get(10)<=16*1024*1024);
    fail(!tags.has(0x6ffffffb) || tags.get(0x6ffffffb)===1);
    fail(!tags.has(24) || tags.get(24)===0);
    const stringSize=tags.get(10),strings=mapped(tags.get(5),stringSize);
    fail(bytes[strings]===0 && bytes[strings+stringSize-1]===0);
    const dependencies=needed.map(index=>{
        fail(index>0 && index<stringSize);const start=strings+index;
        const length=bytes.subarray(start,Math.min(strings+stringSize,start+129)).indexOf(0);fail(length>0);
        const raw=bytes.subarray(start,start+length);fail(raw.every(value=>value>=0x21 && value<=0x7e));
        const name=raw.toString('ascii');fail(LINUX_DEPENDENCIES[kind].includes(name));return name;
    });
    fail(new Set(dependencies).size===dependencies.length);return dependencies.sort();
}

/** Parse native linkage without executing a tool or binary. Darwin retains
 * the existing protected-system Mach-O policy; Linux uses the bounded ELF
 * policy above. Unsupported architectures, libc families and loaders fail.
 */
export function assertClosedNative(bytes,{platform,arch,kind}) {
    const fail=condition=>releaseCheck(condition,'ASTRA_NATIVE_DEPENDENCY_UNCLOSED');
    if(platform==='linux') {fail(arch==='x64');return assertClosedElf(bytes,kind,fail);}
    fail(Buffer.isBuffer(bytes)&&bytes.length>=32&&platform==='darwin'&&['arm64','x64'].includes(arch));
    fail(bytes.readUInt32LE(0)===0xfeedfacf && bytes.readUInt32LE(4)===(arch==='arm64'?0x0100000c:0x01000007));
    const count=bytes.readUInt32LE(16),commandBytes=bytes.readUInt32LE(20);fail(count<=4096&&commandBytes<=bytes.length-32);
    const dependencies=[];let offset=32;
    for(let n=0;n<count;n++) {
        fail(offset+8<=32+commandBytes);const command=bytes.readUInt32LE(offset),length=bytes.readUInt32LE(offset+4);
        fail(length>=8&&offset+length<=32+commandBytes);
        if([0xc,0x80000018,0x8000001f,0x80000023,0x20,0xe].includes(command)) {
            fail(length>=12);const start=bytes.readUInt32LE(offset+8);fail(start>=12&&start<length);
            const end=bytes.indexOf(0,offset+start);fail(end>=offset+start&&end<offset+length);
            const name=bytes.subarray(offset+start,end).toString('utf8');
            fail(/^\/(?:usr\/lib\/|System\/Library\/)[A-Za-z0-9_./+-]+$/.test(name)&&!name.split('/').includes('..'));
            dependencies.push(name);
        }
        // LC_ID_DYLIB identifies this exact engine itself; it is not a load.
        offset+=length;
    }
    fail(offset===32+commandBytes);return dependencies.sort();
}

async function regular(path, { readonly = false } = {}) {
    const stat = await lstat(path);
    releaseCheck(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= LIMIT
        && (!readonly || !(stat.mode & 0o222)), 'ASTRA_ARTIFACT_FILE_UNSAFE');
    return stat;
}
export async function releaseReadFile(path, limit = LIMIT) {
    const before = await regular(path), file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        const stat = await file.stat();
        releaseCheck(stat.dev === before.dev && stat.ino === before.ino && stat.size <= limit, 'ASTRA_ARTIFACT_FILE_UNSAFE');
        const bytes = await file.readFile(), after = await file.stat();
        releaseCheck(bytes.length <= limit && stat.size === after.size && stat.mtimeMs === after.mtimeMs && stat.ctimeMs === after.ctimeMs,
            'ASTRA_ARTIFACT_CHANGED');
        return bytes;
    } finally { await file.close(); }
}
export async function readCanonicalRelease(path, expectedHash, limit = 16_384) {
    releaseCheck(SHA.test(expectedHash ?? ''), 'ASTRA_RELEASE_MANIFEST_CHANGED');
    const bytes = await releaseReadFile(path, limit), text = bytes.toString('utf8');
    releaseCheck(releaseDigest(bytes) === expectedHash, 'ASTRA_RELEASE_MANIFEST_CHANGED');
    let value; try { value = JSON.parse(text); } catch { releaseCheck(false); }
    releaseCheck(releaseCanonical(value) === text); return value;
}
async function scan(root, { readonly = false } = {}) {
    releaseCheck(isAbsolute(root) && resolve(root) === root && await realpath(root) === root, 'ASTRA_ARTIFACT_PATH_INVALID');
    const paths = [], directories = [];
    async function visit(folder) {
        const stat = await lstat(folder);
        releaseCheck(stat.isDirectory() && !stat.isSymbolicLink() && (!readonly || !(stat.mode & 0o222)), 'ASTRA_ARTIFACT_FILE_UNSAFE');
        directories.push(folder);
        for (const name of (await readdir(folder)).sort()) {
            const full = join(folder, name), entry = await lstat(full);
            const path = artifactPath(relative(root, full).split(sep).join('/'));
            releaseCheck(!entry.isSymbolicLink(), 'ASTRA_ARTIFACT_FILE_UNSAFE');
            if (entry.isDirectory()) await visit(full);
            else { await regular(full, { readonly }); paths.push(path); releaseCheck(paths.length <= FILE_LIMIT, 'ASTRA_ARTIFACT_LIMIT'); }
        }
    }
    await visit(root); return { paths: paths.sort(), directories };
}
export function assertReleaseProcess({ env = process.env, execArgv = process.execArgv } = {}) {
    // Code loaders and engine/redirection/debug overrides can bypass a verified
    // module inventory or print private client configuration. No ambient fallback.
    releaseCheck(execArgv.length === 0 && !Object.keys(env).some(key =>
        key==='DEBUG' || key.startsWith('NODE_')&&key!=='NODE_ENV' || key.startsWith('LD_') || key.startsWith('DYLD_')
        || key.startsWith('PRISMA_') || key.startsWith('OPENSSL_')
        || key==='SSL_CERT_FILE' || key==='SSL_CERT_DIR'), 'ASTRA_RELEASE_PROCESS_UNSAFE');
}
function inventoryShape(inventory) {
    exact(inventory, ['version','nodeVersion','platform','arch','prismaEngine','files']);
    releaseCheck(inventory.version === 'atlas-operator-artifact-v1' && nativeTarget(inventory)
        && Array.isArray(inventory.files) && inventory.files.length >= REQUIRED.length + 1 && inventory.files.length < FILE_LIMIT, 'ASTRA_ARTIFACT_CLOSURE_INCOMPLETE');
    artifactPath(inventory.prismaEngine);
    releaseCheck(inventory.prismaEngine===`${PRISMA_ROOT}/${engineTarget(inventory)}`, 'ASTRA_PRISMA_ENGINE_REQUIRED');
    const paths = inventory.files.map(row => {
        exact(row, ['path','sha256','bytes','mode']); artifactPath(row.path);
        releaseCheck(row.path !== ARTIFACT_FILE && SHA.test(row.sha256) && Number.isSafeInteger(row.bytes)
            && row.bytes >= 0 && row.bytes <= LIMIT && [0o444,0o555].includes(row.mode)); return row.path;
    });
    releaseCheck(new Set(paths).size === paths.length && releaseCanonical(paths) === releaseCanonical([...paths].sort())
        && [...REQUIRED, inventory.prismaEngine].every(path => paths.includes(path))
        && paths.filter(path=>path.endsWith('.node')).length===1
        && inventory.files.reduce((n,row) => n+row.bytes,0) <= TOTAL_LIMIT, 'ASTRA_ARTIFACT_CLOSURE_INCOMPLETE');
    // Only bootstrap/verifier/bundle, provenance and generated client bytes.
    // No node_modules lookup, .env, service code or user-selected executable.
    releaseCheck(paths.every(path => REQUIRED.includes(path) || path.startsWith(`${PRISMA_ROOT}/`)), 'ASTRA_ARTIFACT_CLOSURE_INCOMPLETE');
}
function closureShape(closure) {
    exact(closure, ['version','bundler','entry','runtimeHash','inputs','external']);
    releaseCheck(closure.version === 'atlas-operator-closure-v1' && closure.bundler === 'esbuild@0.27.7'
        && closure.entry === 'packages/atlas-operator/src/runtime.mjs' && SHA.test(closure.runtimeHash)
        && Array.isArray(closure.inputs) && closure.inputs.length > 0 && closure.inputs.length <= 300
        && Array.isArray(closure.external) && closure.external.every(path => BUILTINS.has(path)), 'ASTRA_ARTIFACT_CLOSURE_INCOMPLETE');
    const paths = closure.inputs.map(row => { exact(row,['path','sha256']); artifactPath(row.path);
        releaseCheck(SHA.test(row.sha256) && allowedSource(row.path), 'ASTRA_ARTIFACT_CLOSURE_INCOMPLETE'); return row.path; });
    releaseCheck(new Set(paths).size === paths.length && paths.includes(closure.entry)
        && ['packages/atlas-operator/src/ledger.mjs','packages/atlas-operator/src/provider.mjs','packages/atlas-operator/src/adapters.mjs',
            'packages/atlas-service-bridge/src/operator-evidence.mjs','packages/atlas-service-bridge/src/machine-initialize-transport.mjs','packages/atlas-grading-core/dist/report.js'].every(path=>paths.includes(path)),
    'ASTRA_ARTIFACT_CLOSURE_INCOMPLETE');
}
function allowedSource(path) {
    return /^packages\/atlas-operator\/src\/[a-z-]+\.mjs$/.test(path)
        || /^packages\/atlas-service-bridge\/src\/(protocol|transport|operator-images|operator-evidence|machine-initialize-transport)\.mjs$/.test(path)
        || /^packages\/atlas-grading-core\/dist\/[A-Za-z0-9-]+\.js$/.test(path)
        || /^node_modules\/\.pnpm\/zod@4\.1\.11\/node_modules\/zod\/[A-Za-z0-9_./-]+\.js$/.test(path);
}

/** Independent expectedBuildHash comes from the separately pinned release
 * manifest. Verify before ANY runtime/generated-client module import. Recheck
 * again in executeOperatorRun before client construction. No mutation here.
 */
export async function verifyOperatorArtifact({ root, expectedBuildHash }, {
    nodeVersion = process.version, platform = process.platform, arch = process.arch, executablePath = process.execPath,
} = {}) {
    releaseCheck(SHA.test(expectedBuildHash ?? ''), 'ASTRA_ARTIFACT_CHANGED');
    const scanned = await scan(root, { readonly: true });
    const inventory = await readCanonicalRelease(join(root, ARTIFACT_FILE), expectedBuildHash, 128*1024);
    inventoryShape(inventory);
    releaseCheck(inventory.nodeVersion === nodeVersion && inventory.platform === platform && inventory.arch === arch, 'ASTRA_ARTIFACT_PLATFORM_CHANGED');
    releaseCheck(releaseCanonical(scanned.paths) === releaseCanonical([...inventory.files.map(row=>row.path), ARTIFACT_FILE].sort()),
        'ASTRA_ARTIFACT_UNLISTED_FILE');
    for (const row of inventory.files) {
        const path = join(root, row.path), stat = await regular(path, { readonly: true });
        releaseCheck((stat.mode & 0o777) === row.mode && stat.size === row.bytes
            && releaseDigest(await releaseReadFile(path)) === row.sha256, 'ASTRA_ARTIFACT_CHANGED');
    }
    const node = inventory.files.find(row => row.path === NODE_PATH);
    releaseCheck(releaseDigest(await releaseReadFile(await realpath(executablePath))) === node.sha256, 'ASTRA_NODE_BINARY_CHANGED');
    assertClosedNative(await releaseReadFile(join(root,NODE_PATH)),{platform,arch,kind:'executable'});
    assertClosedNative(await releaseReadFile(join(root,inventory.prismaEngine)),{platform,arch,kind:'library'});
    const closureBytes = await releaseReadFile(join(root,'closure.json'),128*1024), closure = JSON.parse(closureBytes.toString('utf8'));
    releaseCheck(releaseCanonical(closure) === closureBytes.toString('utf8')); closureShape(closure);
    releaseCheck(closure.runtimeHash === inventory.files.find(row=>row.path===RUNTIME_PATH).sha256, 'ASTRA_ARTIFACT_CLOSURE_INCOMPLETE');
    // Rewalk after hashing; an added file or symlink must not become an ambient
    // lookup between inventory selection and module import.
    releaseCheck(releaseCanonical((await scan(root,{readonly:true})).paths) === releaseCanonical(scanned.paths), 'ASTRA_ARTIFACT_CHANGED');
    return Object.freeze({ root, buildHash: expectedBuildHash, nodeVersion, runtimePath: join(root,RUNTIME_PATH),
        clientPath: join(root,CLIENT_PATH), enginePath: join(root,inventory.prismaEngine) });
}

/** Deterministic writer; useful with injected tiny bytes in offline tests. The
 * caller still needs the independent release authority to pin its buildHash.
 * The producer below is the sole real command composition and supplies only
 * the actual reviewed bundle/generated-client/engine/Node closure.
 */
export async function writeOperatorArtifact({ root, files, nodeVersion = FIXED_NODE_VERSION, platform = process.platform, arch = process.arch, prismaEngine }) {
    releaseCheck(isAbsolute(root) && resolve(root) === root && files instanceof Map, 'ASTRA_ARTIFACT_PATH_INVALID');
    // A new directory only: never replace an existing artifact or checkout.
    releaseCheck(await realpath(dirname(root)) === dirname(root), 'ASTRA_ARTIFACT_PATH_INVALID');
    await mkdir(root, { mode: 0o700 });
    const rows = []; let total = 0;
    for (const [path, value] of [...files].sort(([a],[b])=>a.localeCompare(b,'en'))) {
        artifactPath(path); releaseCheck(path !== ARTIFACT_FILE && Buffer.isBuffer(value.bytes));
        total += value.bytes.length; releaseCheck(total <= TOTAL_LIMIT && files.size < FILE_LIMIT, 'ASTRA_ARTIFACT_LIMIT');
        const full = join(root,path); await mkdir(dirname(full),{recursive:true,mode:0o700});
        const mode = value.executable ? 0o555 : 0o444;
        await writeFile(full,value.bytes,{flag:'wx',mode}); await chmod(full,mode);
        rows.push({path,sha256:releaseDigest(value.bytes),bytes:value.bytes.length,mode});
    }
    rows.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
    const inventory = {version:'atlas-operator-artifact-v1',nodeVersion,platform,arch,prismaEngine,files:rows};
    inventoryShape(inventory);
    const bytes = releaseCanonical(inventory); await writeFile(join(root,ARTIFACT_FILE),bytes,{flag:'wx',mode:0o444});
    await chmod(join(root,ARTIFACT_FILE),0o444);
    const scanned = await scan(root); for (const folder of scanned.directories.reverse()) await chmod(folder,0o555);
    return { root, buildHash: releaseDigest(bytes), inventory };
}

export function validateGeneratedClient(clientText,schemaText) {
    const start=clientText.indexOf('const config = '),end=clientText.indexOf('\n}',start)+2;let config;
    try {releaseCheck(start>=0&&end>start);config=JSON.parse(clientText.slice(start+15,end));}catch{releaseCheck(false,'ASTRA_PRISMA_CLIENT_CHANGED');}
    releaseCheck(config.clientVersion==='5.22.0' && config.generator?.config?.engineType==='library' && config.activeProvider==='postgresql'
        && releaseCanonical(config.datasourceNames)===releaseCanonical(['db'])
        && releaseCanonical(config.relativeEnvPaths)===releaseCanonical({rootEnvPath:null})
        && releaseCanonical(config.inlineDatasources)===releaseCanonical({db:{url:{fromEnvVar:'ATLAS_DATABASE_URL',value:null}}})
        && config.inlineSchema===schemaText && (schemaText.match(/\bdatasource\s+[A-Za-z0-9_]+\s*\{/g)??[]).length===1
        && /datasource db\s*\{\s*provider\s*=\s*"postgresql"\s*url\s*=\s*env\("ATLAS_DATABASE_URL"\)\s*\}/.test(schemaText),
        'ASTRA_PRISMA_CLIENT_CHANGED');
}

async function fixedSource(root, path) {
    artifactPath(path); const full = join(root,path);
    releaseCheck(await realpath(full) === full && within(root,full), 'ASTRA_ARTIFACT_PATH_INVALID');
    return releaseReadFile(full);
}
export async function bundleOperatorRuntime(sourceRoot) {
    // Exact installed lock version; no package manager, build script, download,
    // caller module URL, custom plugin or environment-selected build adapter.
    const esbuildPath = 'node_modules/.pnpm/esbuild@0.27.7/node_modules/esbuild/lib/main.js';
    await fixedSource(sourceRoot,esbuildPath);
    const { build, version } = await import(pathToFileURL(join(sourceRoot,esbuildPath)).href);
    releaseCheck(version === '0.27.7', 'ASTRA_RELEASE_BUNDLER_CHANGED');
    const sourceHashes = {};
    const result = await build({absWorkingDir:sourceRoot,entryPoints:['packages/atlas-operator/src/runtime.mjs'],
        outfile:'runtime/operator.mjs',bundle:true,write:false,metafile:true,format:'esm',platform:'node',
        target:[`node${process.version.slice(1)}`],packages:'bundle',conditions:['node','import','default'],
        sourcemap:false,minify:false,legalComments:'none',logLevel:'silent',
        plugins:[{name:'closed-atlas-inputs',setup(builder){builder.onLoad({filter:/\.(?:mjs|js)$/},async args=>{
            const path=relative(sourceRoot,args.path).split(sep).join('/');
            artifactPath(path);releaseCheck(allowedSource(path),'ASTRA_ARTIFACT_CLOSURE_INCOMPLETE');
            const bytes=await fixedSource(sourceRoot,path);sourceHashes[path]=releaseDigest(bytes);
            return {contents:bytes,loader:'js',resolveDir:dirname(args.path)};
        });}}]});
    return {...result,sourceHashes};
}

/** Offline package command only; bindings are hashes, never credentials. */
export async function packageOperatorRelease({ sourceRoot, outputRoot, releaseSha, bindings }, {
    bundle = bundleOperatorRuntime, nodeVersion = process.version, platform = process.platform, arch = process.arch,
    executablePath = process.execPath,
} = {}) {
    releaseCheck(nativeTarget({nodeVersion,platform,arch}) && isAbsolute(sourceRoot) && await realpath(sourceRoot) === sourceRoot,
        'ASTRA_ARTIFACT_PLATFORM_CHANGED');
    releaseCheck(/^[a-f0-9]{40}$/.test(releaseSha??'') && releaseSha !== '0'.repeat(40), 'ASTRA_RELEASE_MANIFEST_INVALID');
    exact(bindings,['databaseBindingHash','providerBindingHash','imageBridge','machineInitialization']); exact(bindings.imageBridge,['origin','keyHash']);
    releaseCheck([bindings.databaseBindingHash,bindings.providerBindingHash,bindings.imageBridge.keyHash].every(v=>SHA.test(v??'')));
    const origin = new URL(bindings.imageBridge.origin);
    releaseCheck(origin.protocol==='https:' && origin.origin===bindings.imageBridge.origin && !origin.username && !origin.password
        && !['localhost','127.0.0.1','[::1]'].includes(origin.hostname));
    if(bindings.machineInitialization!==null) {
        exact(bindings.machineInitialization,['origin','admissionKeyHash','executionKeyHash']);
        const value=bindings.machineInitialization,target=new URL(value.origin);
        releaseCheck(target.protocol==='https:'&&target.origin===value.origin&&!target.username&&!target.password
            && !['localhost','127.0.0.1','[::1]'].includes(target.hostname)
            && [value.admissionKeyHash,value.executionKeyHash].every(hash=>SHA.test(hash??''))
            && new Set([value.admissionKeyHash,value.executionKeyHash,bindings.imageBridge.keyHash]).size===3);
    }
    const generated = join(sourceRoot,PRISMA_ROOT), listing = await scan(generated);
    releaseCheck(listing.paths.every(path=>/^(?:(?:default|edge|index|index-browser|wasm)\.(?:js|d\.ts)|package\.json|schema\.prisma|runtime\/[a-z-]+\.(?:js|d\.ts)|libquery_engine-[a-z0-9.-]+\.node)$/.test(path)),
        'ASTRA_PRISMA_CLIENT_CHANGED');
    const engines = listing.paths.filter(path=>/^libquery_engine-[a-z0-9.-]+\.node$/.test(path));
    // One actual generated target. Cross-platform releases must be generated
    // separately by the release owner; this producer never fetches an engine.
    releaseCheck(engines.length===1 && engines[0]===engineTarget({platform,arch}),
        'ASTRA_PRISMA_ENGINE_REQUIRED');
    const generatedFiles=new Map();
    for(const path of listing.paths)generatedFiles.set(path,await fixedSource(sourceRoot,`${PRISMA_ROOT}/${path}`));
    const clientBytes=generatedFiles.get('index.js'),clientText=clientBytes.toString('utf8');
    const pkg=JSON.parse(generatedFiles.get('package.json').toString('utf8'));
    releaseCheck(pkg.version==='5.22.0' && clientText.includes(`path.join(__dirname, "${engines[0]}")`), 'ASTRA_PRISMA_CLIENT_CHANGED');
    validateGeneratedClient(clientText,generatedFiles.get('schema.prisma').toString('utf8'));
    const nodeBytes=await releaseReadFile(await realpath(executablePath));
    assertClosedNative(nodeBytes,{platform,arch,kind:'executable'});
    assertClosedNative(generatedFiles.get(engines[0]),{platform,arch,kind:'library'});
    const result = await bundle(sourceRoot);
    releaseCheck(result.outputFiles?.length===1 && result.metafile?.inputs && result.metafile?.outputs, 'ASTRA_ARTIFACT_CLOSURE_INCOMPLETE');
    const output = result.outputFiles[0], bundleBytes = Buffer.from(output.contents), inputs=[];
    for (const path of Object.keys(result.metafile.inputs).sort()) {
        artifactPath(path); releaseCheck(allowedSource(path),'ASTRA_ARTIFACT_CLOSURE_INCOMPLETE');
        const sha256=releaseDigest(await fixedSource(sourceRoot,path));
        releaseCheck(result.sourceHashes?.[path]===sha256,'ASTRA_RELEASE_SOURCE_CHANGED');
        inputs.push({path,sha256});
    }
    const outputMeta = Object.values(result.metafile.outputs);
    releaseCheck(outputMeta.length===1 && outputMeta[0].entryPoint==='packages/atlas-operator/src/runtime.mjs', 'ASTRA_ARTIFACT_CLOSURE_INCOMPLETE');
    const external = outputMeta[0].imports.map(row=>{releaseCheck(row.external && BUILTINS.has(row.path),'ASTRA_ARTIFACT_CLOSURE_INCOMPLETE');return row.path;}).sort();
    const closure={version:'atlas-operator-closure-v1',bundler:'esbuild@0.27.7',entry:'packages/atlas-operator/src/runtime.mjs',runtimeHash:releaseDigest(bundleBytes),inputs,external};
    closureShape(closure);
    const files=new Map([[RUNTIME_PATH,{bytes:bundleBytes}],[BOOTSTRAP_PATH,{bytes:await fixedSource(sourceRoot,BOOTSTRAP_PATH)}],
        [VERIFIER_PATH,{bytes:await fixedSource(sourceRoot,VERIFIER_PATH)}],['closure.json',{bytes:Buffer.from(releaseCanonical(closure))}],
        [NODE_PATH,{bytes:nodeBytes,executable:true}]]);
    for (const path of listing.paths) {
        const bytes=generatedFiles.get(path);
        releaseCheck(releaseDigest(await fixedSource(sourceRoot,`${PRISMA_ROOT}/${path}`))===releaseDigest(bytes),'ASTRA_RELEASE_SOURCE_CHANGED');
        files.set(`${PRISMA_ROOT}/${path}`,{bytes,executable:path===engines[0]});
    }
    releaseCheck(releaseCanonical((await scan(generated)).paths)===releaseCanonical(listing.paths),'ASTRA_RELEASE_SOURCE_CHANGED');
    const artifact=await writeOperatorArtifact({root:outputRoot,files,nodeVersion,platform,arch,prismaEngine:`${PRISMA_ROOT}/${engines[0]}`});
    const runtimeHash=releaseDigest(releaseCanonical({version:'atlas-operator-runtime-v1',mode:'PRODUCTION',releaseSha,buildHash:artifact.buildHash,
        providerBindingHash:bindings.providerBindingHash,databaseBindingHash:bindings.databaseBindingHash}));
    const manifest={version:'atlas-operator-release-v2',mode:'PRODUCTION',model:'gpt-6-astra',nodeVersion,
        releaseSha,buildHash:artifact.buildHash,
        runtimeHash,...bindings,machineInitialization:bindings.machineInitialization===null?null:{...bindings.machineInitialization,runtimeHash},
        tools:['read_card_report','inspect_region','inspect_card_geometry','measure_centering','inspect_finding',
            'propose_identity','propose_finding_change','submit_for_human_review','read_original_photos','propose_capture_identity','propose_physical_boundary','submit_capture_preparation']};
    return {...artifact,manifest,manifestBytes:releaseCanonical(manifest),manifestHash:releaseDigest(releaseCanonical(manifest))};
}
