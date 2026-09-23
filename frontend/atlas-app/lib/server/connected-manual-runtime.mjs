import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { createPhotoStorage } from '@atlas/photo-storage';
import { createManualArtifactStore,createS3ManualArtifactTransport } from '@atlas/manual-service/artifacts';
import { createDurableStaffBoundary } from '@atlas/manual-service/staff-auth';
import { createConnectedManual } from '@atlas/connected-manual';
import { createConnectedHandler } from '@atlas/connected-manual/http';
import { identificationEffects } from '@atlas/connected-manual/identification';
import { createAstraDefectProvider } from '@atlas/defect-analysis/provider';
import { requireThat } from '@atlas/manual-service/contract';
import { descriptorSha256 } from '@atlas/photo-core';
import { createApprovedManualReader } from '@atlas/connected-manual/publication-reader';
import { createSoldReferenceProvider } from '@atlas/connected-manual/presentation-market-provider';
import { createStationSigner } from '@atlas/connected-manual/finishing-station-protocol';

export function manualStationSettings(env,origin) {
  if(env.ATLAS_MANUAL_STATION_ENABLED!=='true')return null;
  requireThat(origin==='https://atlasgrading.com'
    && typeof env.ATLAS_MANUAL_STATION_PRIVATE_KEY_PEM==='string' && env.ATLAS_MANUAL_STATION_PRIVATE_KEY_PEM.length<=8192
    && typeof env.ATLAS_MANUAL_STATION_TRUSTED_STATIONS_JSON==='string' && Buffer.byteLength(env.ATLAS_MANUAL_STATION_TRUSTED_STATIONS_JSON)<=65536,
  503,'FINISHING_STATION_CONFIGURATION_INVALID');
  let trustedStations,signer;
  try{
    trustedStations=JSON.parse(env.ATLAS_MANUAL_STATION_TRUSTED_STATIONS_JSON);
    requireThat(Array.isArray(trustedStations)&&trustedStations.length<=64);
    signer=createStationSigner({keyId:env.ATLAS_MANUAL_STATION_KEY_ID,privateKey:env.ATLAS_MANUAL_STATION_PRIVATE_KEY_PEM});
  }catch{requireThat(false,503,'FINISHING_STATION_CONFIGURATION_INVALID');}
  return{origin,signer,trustedStations};
}

export function manualRuntimeSettings(env,staffConfig) {
  if(env.ATLAS_MANUAL_ENABLED!=='true')return null;
  requireThat(!env.VERCEL && !env.AWS_LAMBDA_FUNCTION_NAME,503,'MANUAL_SELF_HOSTED_RUNTIME_REQUIRED');
  let database,staff,endpoint,uploadOrigin;
  try{database=new URL(env.ATLAS_MANUAL_DATABASE_URL);staff=new URL(staffConfig.databaseUrl);endpoint=new URL(env.ATLAS_MANUAL_STORAGE_ENDPOINT);uploadOrigin=new URL(env.ATLAS_MANUAL_UPLOAD_ORIGIN);}
  catch{requireThat(false,503,'MANUAL_CONFIGURATION_INVALID');}
  requireThat(['postgres:','postgresql:'].includes(database.protocol) && database.hostname===staff.hostname && database.port===staff.port
    && database.pathname===staff.pathname && database.username && database.password && database.username!==staff.username && database.searchParams.get('schema')==='atlas_manual'
    && (staffConfig.mode!=='PRODUCTION'||database.searchParams.get('sslmode')==='require'),503,'MANUAL_DATABASE_CONFIGURATION_INVALID');
  requireThat(endpoint.protocol==='https:' && !endpoint.username && !endpoint.password && endpoint.pathname==='/' && !endpoint.search && !endpoint.hash
    && uploadOrigin.protocol==='https:' && uploadOrigin.origin===env.ATLAS_MANUAL_UPLOAD_ORIGIN,503,'MANUAL_STORAGE_CONFIGURATION_INVALID');
  requireThat(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(env.ATLAS_MANUAL_STORAGE_BUCKET??'')
    && /^[a-z0-9-]{1,40}$/.test(env.ATLAS_MANUAL_STORAGE_REGION??'')
    && /^[a-zA-Z0-9][a-zA-Z0-9_/-]{0,100}$/.test(env.ATLAS_MANUAL_STORAGE_PREFIX??'')
    && !env.ATLAS_MANUAL_STORAGE_PREFIX.includes('..')
    && typeof env.ATLAS_MANUAL_PYTHON==='string' && env.ATLAS_MANUAL_PYTHON.startsWith('/'),503,'MANUAL_CONFIGURATION_INVALID');
  requireThat(typeof env.ATLAS_MANUAL_STORAGE_ACCESS_KEY==='string' && env.ATLAS_MANUAL_STORAGE_ACCESS_KEY.length>=8
    && typeof env.ATLAS_MANUAL_STORAGE_SECRET_KEY==='string' && env.ATLAS_MANUAL_STORAGE_SECRET_KEY.length>=16,503,'MANUAL_STORAGE_CONFIGURATION_INVALID');
  return {databaseUrl:database.href,endpoint:endpoint.origin,uploadOrigin:uploadOrigin.origin,bucket:env.ATLAS_MANUAL_STORAGE_BUCKET,
    region:env.ATLAS_MANUAL_STORAGE_REGION,keyPrefix:env.ATLAS_MANUAL_STORAGE_PREFIX,pythonExecutable:env.ATLAS_MANUAL_PYTHON};
}

/** Private CPU service behind the approved Vercel staff application.
 * The signed transport forwards the ordinary staff cookie; auth rechecks the
 * independently restricted manual DB role on every short transaction. */
export function createServingConnectedManual({env,auth,staffConfig,Client,assertRequest}) {
  const settings=manualRuntimeSettings(env,staffConfig);if(!settings)return null;
  const manualClient=new Client({datasources:{db:{url:settings.databaseUrl}},errorFormat:'minimal'});
  const boundary=createDurableStaffBoundary({auth,manualClient});
  const client=new S3Client({region:settings.region,endpoint:settings.endpoint,maxAttempts:1,
    credentials:{accessKeyId:env.ATLAS_MANUAL_STORAGE_ACCESS_KEY,secretAccessKey:env.ATLAS_MANUAL_STORAGE_SECRET_KEY}});
  const baseStorage=createPhotoStorage({client,bucket:settings.bucket,keyPrefix:settings.keyPrefix,limits:{maxObjectBytes:256*1024*1024,timeoutMs:90000}});
  const storage={...baseStorage,async createOriginalUpload(input){const result=await baseStorage.createOriginalUpload(input);
    requireThat(new URL(result.url).origin===settings.uploadOrigin,503,'MANUAL_UPLOAD_ORIGIN_MISMATCH');return result;}};
  const artifactClient={send:(command,options={})=>client.send(command,{...options,abortSignal:options.abortSignal?AbortSignal.any([options.abortSignal,AbortSignal.timeout(90000)]):AbortSignal.timeout(90000)})};
  const artifacts=createManualArtifactStore({transport:createS3ManualArtifactTransport({client:artifactClient,bucket:settings.bucket,PutObjectCommand,GetObjectCommand}),prefix:`${settings.keyPrefix}/artifacts`});
  const effects=env.ATLAS_MANUAL_IDENTIFICATION_ENABLED==='true'?identificationEffects({openaiKey:env.ATLAS_MANUAL_OPENAI_KEY,googleKey:env.ATLAS_MANUAL_GOOGLE_VISION_KEY}):null;
  const reads=new Map();
  const imageReadUrl=async({kind,descriptor,photo})=>{
    const key=descriptorSha256(descriptor),cached=reads.get(key);if(cached&&cached.expires>Date.now())return cached.value;
    const value=kind==='original'?await storage.createDecodedFrameRead({frame:descriptor,original:photo.original,decodePlan:photo.decodePlan,expiresIn:300})
      :await storage.createDerivativeRead({descriptor,frame:photo.workingFrame,original:photo.original,decodePlan:photo.decodePlan,expiresIn:300});
    requireThat(new URL(value.url).origin===settings.uploadOrigin,503,'MANUAL_UPLOAD_ORIGIN_MISMATCH');
    if(reads.size>=1000)reads.delete(reads.keys().next().value);reads.set(key,{value,expires:Date.now()+240000});return value;
  };
  const memoryEnabled=env.ATLAS_MANUAL_DEFECT_MEMORY_ENABLED==='true';
  const defectProvider=env.ATLAS_MANUAL_DEFECT_ANALYSIS_ENABLED==='true'?createAstraDefectProvider({apiKey:env.ATLAS_MANUAL_OPENAI_KEY}):null;
  requireThat(!defectProvider||memoryEnabled,503,'DEFECT_ANALYSIS_MEMORY_REQUIRED');
  // Cold by default: enabling requires the separate additive queue migration
  // and narrow serving grants. Construction never resumes paid work by itself.
  const batchEnabled=env.ATLAS_MANUAL_BATCH_ENABLED==='true';
  const presentationEnabled=env.ATLAS_MANUAL_PRESENTATION_ENABLED==='true';
  const marketProvider=env.ATLAS_MANUAL_MARKET_ENABLED==='true'?createSoldReferenceProvider({apiKey:env.ATLAS_MANUAL_SOLD_COMPS_API_KEY}):null;
  requireThat(!marketProvider||presentationEnabled,503,'MARKET_PRESENTATION_REQUIRED');
  const stationConfig=manualStationSettings(env,staffConfig.origin);
  const connected=createConnectedManual({memoryEnabled,defectProvider,batchEnabled,presentationEnabled,marketProvider,stationConfig,boundary,storage,artifacts,keyPrefix:settings.keyPrefix,pythonExecutable:settings.pythonExecutable,effects,receiptClient:manualClient,imageReadUrl});
  const handler=createConnectedHandler({connected,boundary,origin:staffConfig.origin,assertRequest});
  // Give the private host only GET reconciliation capabilities for its worker.
  // Construction is cold: no database scan or provider request starts here.
  const analysisReconciler=connected.assistance.executor?Object.freeze({
    pending:input=>connected.assistance.executor.pending(input),
    reconcile:input=>connected.assistance.executor.reconcile(input),
  }):null;
  const approvedManualReader=createApprovedManualReader({client:manualClient,artifacts,storage,presentationEnabled});
  return {connected,boundary,handler,analysisReconciler,approvedManualReader,uploadOrigin:settings.uploadOrigin,async close(){connected.batch?.worker.stop();await manualClient.$disconnect();client.destroy();}};
}
