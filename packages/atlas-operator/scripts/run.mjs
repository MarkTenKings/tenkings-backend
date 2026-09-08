// Trusted minimal bootstrap: no package/bundle/generated client import occurs
// before the independent release manifest and entire read-only artifact pass.
import { isAbsolute, resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { releaseCheck as check, readCanonicalRelease, verifyOperatorArtifact, assertReleaseProcess } from '../src/release-artifact.mjs';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA=/^[a-f0-9]{64}$/;
export function parseArguments(args) {
    check(Array.isArray(args)&&args.length===6,'ASTRA_CLI_ARGUMENTS_REQUIRED');const options={};
    for(let n=0;n<args.length;n+=2){
        check(['--run-id','--initialization-id','--manifest','--manifest-sha256'].includes(args[n])&&!Object.hasOwn(options,args[n]),'ASTRA_CLI_ARGUMENTS_REQUIRED');
        options[args[n]]=args[n+1];
    }
    const target=Object.hasOwn(options,'--run-id')?'--run-id':'--initialization-id';
    check(!(Object.hasOwn(options,'--run-id')&&Object.hasOwn(options,'--initialization-id'))
        && UUID.test(options[target])&&SHA.test(options['--manifest-sha256'])
        &&typeof options['--manifest']==='string'&&isAbsolute(options['--manifest']),'ASTRA_CLI_ARGUMENTS_REQUIRED');
    return {...(target==='--run-id'?{runId:options[target]}:{initializationId:options[target]}),manifestPath:options['--manifest'],manifestHash:options['--manifest-sha256']};
}
export const readReleaseManifest=readCanonicalRelease;
const artifactRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
export async function main(args,env,{
    readManifest=readReleaseManifest,verifyArtifact=verifyOperatorArtifact,
    loadRuntime=path=>import(pathToFileURL(path).href),loadClient=path=>import(pathToFileURL(path).href),
    execute,executeInitialization,signals=process,root=artifactRoot,execArgv=process.execArgv,
}={}){
    const controller=new AbortController(),stop=()=>{if(!controller.signal.aborted)controller.abort();};
    signals.on('SIGINT',stop);signals.on('SIGTERM',stop);
    let selectedInitializationId=null,executing=false;
    try{
        const options=parseArguments(args);selectedInitializationId=options.initializationId??null;
        check(env.ATLAS_OPERATOR_ENABLED==='true','ASTRA_RUNTIME_INACTIVE');
        assertReleaseProcess({env,execArgv});
        const manifest=await readManifest(options.manifestPath,options.manifestHash);
        const artifact=await verifyArtifact({root,expectedBuildHash:manifest.buildHash});
        // Fixed destinations inside the verified closure; no caller module URL.
        const runtime=await loadRuntime(artifact.runtimePath);
        runtime.productionOperatorConfig({env,manifest,manifestHash:options.manifestHash});
        const dependencies={async createClient(databaseUrl){
            const {PrismaClient}=await loadClient(artifact.clientPath);
            check(PrismaClient,'ASTRA_DATABASE_CLIENT_REQUIRED');
            // Exact pinned Prisma 5.22 library.js consumes __internal.engine.
            // binaryPath as prismaPath before any ambient engine search. The
            // artifact includes its implementation and the native engine bytes.
            return new PrismaClient({datasources:{db:{url:databaseUrl}},errorFormat:'minimal',log:[],
                __internal:{engine:{binaryPath:artifact.enginePath}}});
        }};
        executing=true;
        const method=selectedInitializationId?(executeInitialization??runtime.executeOperatorInitialization):(execute??runtime.executeOperatorRun);
        return await method({env,manifest,manifestHash:options.manifestHash,
            ...(selectedInitializationId?{initializationId:selectedInitializationId}:{runId:options.runId}),signal:controller.signal,artifactRoot:root},dependencies);
    }catch(error){
        const code=/^ASTRA_[A-Z0-9_]{1,74}$/.test(error?.code)?error.code:'ASTRA_CLI_FAILED';
        return {...(selectedInitializationId?{initializationId:selectedInitializationId,initializationState:executing?'UNKNOWN':'NOT_STARTED'}:{}),
            runId:null,state:executing&&selectedInitializationId?'RECONCILIATION_REQUIRED':code==='ASTRA_RUNTIME_INACTIVE'?'INACTIVE':'CONFIGURATION_REJECTED',code,stepsApplied:0,
            receipts:{total:0,persisted:0,unconfirmed:0,pending:0},disconnect:'NOT_OPENED',exitCode:executing&&selectedInitializationId?3:code==='ASTRA_RUNTIME_INACTIVE'?78:64};
    }finally{signals.off('SIGINT',stop);signals.off('SIGTERM',stop);}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
    const result=await main(process.argv.slice(2),process.env);
    process.stdout.write(`${JSON.stringify(result)}\n`,()=>process.exit(result.exitCode));
}
