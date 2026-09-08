// Explicit offline producer. This command neither enables controls nor connects
// to a DB/provider. It uses only installed locked build dependencies.
import { writeFile, chmod, realpath } from 'node:fs/promises';
import { isAbsolute, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { packageOperatorRelease, readCanonicalRelease, assertReleaseProcess, releaseCheck as check } from '../src/release-artifact.mjs';
export function packageArguments(args) {
    check(Array.isArray(args)&&args.length===12,'ASTRA_PACKAGE_ARGUMENTS_REQUIRED');const values={};
    const allowed=['--source-root','--output','--bindings','--bindings-sha256','--release-sha','--manifest-out'];
    for(let n=0;n<args.length;n+=2){check(allowed.includes(args[n])&&!Object.hasOwn(values,args[n]),'ASTRA_PACKAGE_ARGUMENTS_REQUIRED');values[args[n]]=args[n+1];}
    check(['--source-root','--output','--bindings','--manifest-out'].every(key=>typeof values[key]==='string'&&isAbsolute(values[key]))
        && /^[a-f0-9]{64}$/.test(values['--bindings-sha256'])&&/^[a-f0-9]{40}$/.test(values['--release-sha']), 'ASTRA_PACKAGE_ARGUMENTS_REQUIRED');
    check(!resolve(values['--manifest-out']).startsWith(`${resolve(values['--output'])}/`),'ASTRA_PACKAGE_ARGUMENTS_REQUIRED');
    return values;
}
export async function packageMain(args,env=process.env,{produce=packageOperatorRelease,execArgv=process.execArgv}={}){
    try{
        assertReleaseProcess({env,execArgv});check(!Object.keys(env).some(key=>key.startsWith('ESBUILD_')),'ASTRA_RELEASE_PROCESS_UNSAFE');
        const values=packageArguments(args);
        const parent=dirname(resolve(values['--manifest-out']));check(await realpath(parent)===parent,'ASTRA_ARTIFACT_PATH_INVALID');
        const bindings=await readCanonicalRelease(values['--bindings'],values['--bindings-sha256']);
        const result=await produce({sourceRoot:values['--source-root'],outputRoot:values['--output'],releaseSha:values['--release-sha'],bindings});
        await writeFile(values['--manifest-out'],result.manifestBytes,{flag:'wx',mode:0o444});await chmod(values['--manifest-out'],0o444);
        return {state:'PACKAGED_INACTIVE',buildHash:result.buildHash,manifestHash:result.manifestHash,
            artifactRoot:result.root,manifestPath:values['--manifest-out'],nodeVersion:result.inventory.nodeVersion,
            platform:result.inventory.platform,arch:result.inventory.arch,exitCode:0};
    }catch(error){return {state:'PACKAGE_REJECTED',code:/^ASTRA_[A-Z0-9_]{1,74}$/.test(error?.code)?error.code:'ASTRA_PACKAGE_FAILED',exitCode:64};}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
    const result=await packageMain(process.argv.slice(2));process.stdout.write(`${JSON.stringify(result)}\n`);process.exitCode=result.exitCode;
}
