import { createReportImageProvider } from '@atlas/connected-manual/report-image-provider';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { createPhotoStorage } from '@atlas/photo-storage';
import { createManualArtifactStore,createS3ManualArtifactTransport } from '@atlas/manual-service/artifacts';
import { createDurableStaffBoundary } from '@atlas/manual-service/staff-auth';
import { createMachineStaffBoundary } from '@atlas/manual-service/machine-auth';
import { createConnectedManual } from '@atlas/connected-manual';
import { geometryProcessingEnvironment } from '@atlas/connected-manual/geometry-processing';
import { createConnectedHandler } from '@atlas/connected-manual/http';
import { identificationEffects } from '@atlas/connected-manual/identification';
import { createAstraDefectProvider } from '@atlas/defect-analysis/provider';
import { requireThat } from '@atlas/manual-service/contract';
import { descriptorSha256 } from '@atlas/photo-core';
import { createApprovedManualReader } from '@atlas/connected-manual/publication-reader';
import { createSoldReferenceProvider } from '@atlas/connected-manual/presentation-market-provider';
import { createStationSigner } from '@atlas/connected-manual/finishing-station-protocol';
import { manualResearchSettings, manualDealerConfigurationLoader } from './market-runtime-settings.mjs';
import { createDealerStaffService } from '../../../../packages/atlas-connected-manual/src/dealer-operations.mjs';

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

export function manualProcessingSettings(env) {
  const setting=(name,fallback,max)=>{
    const value=env[name]===undefined?fallback:Number(env[name]);
    requireThat(Number.isInteger(value)&&value>=1&&value<=max,503,'MANUAL_PROCESSING_CONFIG_INVALID');return value;
  };
  return Object.freeze({nativeConcurrency:setting('ATLAS_MANUAL_NATIVE_CONCURRENCY',2,12),
    verificationConcurrency:setting('ATLAS_MANUAL_VERIFY_CONCURRENCY',4,16),
    executionConcurrency:setting('ATLAS_MANUAL_BATCH_CONCURRENCY',20,128),
    analysisConcurrency:setting('ATLAS_MANUAL_ANALYSIS_CONCURRENCY',64,128),
    ...geometryProcessingEnvironment(env)});
}

export async function validateLearningRuntimeConfiguration({memoryEnabled,learningEnabled,client}) {
  if(memoryEnabled&&!learningEnabled){
    const [found]=await client.$queryRawUnsafe("SELECT to_regclass('atlas_manual.learning_control') IS NOT NULL AS installed");
    requireThat(found?.installed===false,503,'MEMORY_LIFECYCLE_FLAG_REQUIRED');
  }
}

/** Private CPU service behind the approved Vercel staff application.
 * The signed transport forwards the ordinary staff cookie; auth rechecks the
 * independently restricted manual DB role on every short transaction. */
export function createServingConnectedManual({env,auth,staffConfig,Client,assertRequest,onWorkerError=()=>{}}) {
  const settings=manualRuntimeSettings(env,staffConfig);if(!settings)return null;
  const manualClient=new Client({datasources:{db:{url:settings.databaseUrl}},errorFormat:'minimal'});
  const boundary=createMachineStaffBoundary({auth,manualClient,boundary:createDurableStaffBoundary({auth,manualClient})});
  const client=new S3Client({region:settings.region,endpoint:settings.endpoint,maxAttempts:1,
    credentials:{accessKeyId:env.ATLAS_MANUAL_STORAGE_ACCESS_KEY,secretAccessKey:env.ATLAS_MANUAL_STORAGE_SECRET_KEY}});
  const baseStorage=createPhotoStorage({client,bucket:settings.bucket,keyPrefix:settings.keyPrefix,limits:{maxObjectBytes:256*1024*1024,timeoutMs:90000}});
  const storage={...baseStorage,async createOriginalUpload(input){const result=await baseStorage.createOriginalUpload(input);
    requireThat(new URL(result.url).origin===settings.uploadOrigin,503,'MANUAL_UPLOAD_ORIGIN_MISMATCH');return result;}};
  const artifactClient={send:(command,options={})=>client.send(command,{...options,abortSignal:options.abortSignal?AbortSignal.any([options.abortSignal,AbortSignal.timeout(90000)]):AbortSignal.timeout(90000)})};
  const artifacts=createManualArtifactStore({transport:createS3ManualArtifactTransport({client:artifactClient,bucket:settings.bucket,PutObjectCommand,GetObjectCommand}),prefix:`${settings.keyPrefix}/artifacts`});
  const effects=env.ATLAS_MANUAL_IDENTIFICATION_ENABLED==='true'?identificationEffects({openaiKey:env.ATLAS_MANUAL_OPENAI_KEY,googleKey:env.ATLAS_MANUAL_GOOGLE_VISION_KEY}):null;
  const reads=new Map();
  const imageReadUrl=async({kind,descriptor,photo,photoSource,contextOnly=false})=>{
    const key=`${kind}:${contextOnly}:${descriptorSha256(descriptor)}`,cached=reads.get(key);
    if(cached&&cached.expires>Date.now())return cached.value;
    let value;
    if(kind==='original'&&connected.reviewDisplay)value=await connected.reviewDisplay.read(photo,photoSource,{contextOnly});
    else if(kind==='original'&&contextOnly)value={...descriptor.raster.content,...descriptor.raster.dimensions,displayState:{state:'PENDING',retryable:true}};
    else value=kind==='original'?await storage.createDecodedFrameRead({frame:descriptor,original:photo.original,decodePlan:photo.decodePlan,expiresIn:300})
      :await storage.createImmutableDerivativeRead({descriptor,frame:photo.workingFrame,original:photo.original,decodePlan:photo.decodePlan,expiresIn:300});
    for(const grant of [value,value.preview,value.display,value.display?.preview])if(grant?.url)
      requireThat(new URL(grant.url).origin===settings.uploadOrigin,503,'MANUAL_UPLOAD_ORIGIN_MISMATCH');
    if(kind!=='original')value={...value,...descriptor.raster.dimensions,descriptorSha256:descriptorSha256(descriptor)};
    if(reads.size>=1000)reads.delete(reads.keys().next().value);
    if((!value.displayState||value.displayState.state==='READY')&&(!value.previewState||value.previewState.state==='READY'))
      reads.set(key,{value,expires:Date.now()+240000});
    else reads.delete(key); // Explicit retry/read observes the newly queued state immediately.
    return value;
  };
  const memoryEnabled=env.ATLAS_MANUAL_DEFECT_MEMORY_ENABLED==='true';
  const defectProvider=env.ATLAS_MANUAL_DEFECT_ANALYSIS_ENABLED==='true'?createAstraDefectProvider({apiKey:env.ATLAS_MANUAL_OPENAI_KEY}):null;
  requireThat(!defectProvider||memoryEnabled,503,'DEFECT_ANALYSIS_MEMORY_REQUIRED');
  // Cold by default: enabling requires the separate additive queue migration
  // and narrow serving grants. Construction never resumes paid work by itself.
  const batchEnabled=env.ATLAS_MANUAL_BATCH_ENABLED==='true';
  const presentationEnabled=env.ATLAS_MANUAL_PRESENTATION_ENABLED==='true';
  const reportImageSettings=manualReportImageSettings(env);
  const reportImageProvider=reportImageSettings?createReportImageProvider({apiKey:reportImageSettings.apiKey}):null;
  const marketProvider=env.ATLAS_MANUAL_MARKET_ENABLED==='true'?createSoldReferenceProvider({apiKey:env.ATLAS_MANUAL_SOLD_COMPS_API_KEY}):null;
  requireThat(!marketProvider||presentationEnabled,503,'MARKET_PRESENTATION_REQUIRED');
  const stationConfig=manualStationSettings(env,staffConfig.origin);
  const researchConfig=manualResearchSettings(env),dealerConfiguration=manualDealerConfigurationLoader(env);
  const dealerOperations=env.ATLAS_MANUAL_DEALER_OPERATIONS_ENABLED==='true'?createDealerStaffService({auth,boundary}):null;
  const connected=createConnectedManual({displayEnabled:env.ATLAS_MANUAL_REVIEW_DELIVERY_ENABLED==='true',learningEnabled:env.ATLAS_MANUAL_LEARNING_LIFECYCLE_ENABLED==='true',dealerOperations,memoryEnabled,defectProvider,batchEnabled,presentationEnabled,reportImageProvider,reportImageConcurrency:reportImageSettings?.concurrency,marketProvider,dealerConfiguration,researchConfig,stationConfig,boundary,storage,artifacts,keyPrefix:settings.keyPrefix,pythonExecutable:settings.pythonExecutable,effects,receiptClient:manualClient,imageReadUrl,
    processing:manualProcessingSettings(env),onWorkerError});
  const handler=createConnectedHandler({connected,boundary,origin:staffConfig.origin,assertRequest});
  // Give the private host only GET reconciliation capabilities for its worker.
  // Construction is cold: no database scan or provider request starts here.
  const analysisReconciler=connected.assistance.executor?Object.freeze({
    pending:input=>connected.assistance.executor.pending(input),
    reconcile:input=>connected.assistance.executor.reconcile(input),
  }):null;
  const approvedManualReader=createApprovedManualReader({client:manualClient,artifacts,storage,presentationEnabled,reportImages:connected.reportImages,dealerOffers:connected.dealerOffers,reviewDisplay:connected.reviewDisplay});
  const validateConfiguration=()=>validateLearningRuntimeConfiguration({memoryEnabled,learningEnabled:env.ATLAS_MANUAL_LEARNING_LIFECYCLE_ENABLED==='true',client:manualClient});
  return {connected,boundary,handler,analysisReconciler,approvedManualReader,validateConfiguration,uploadOrigin:settings.uploadOrigin,async close(){await Promise.all([connected.ingestion?.stop(),connected.batch?.worker.stop(),connected.reviewDisplay?.stop(),connected.reportImages?.stop(),connected.learning?.stop()]);await manualClient.$disconnect();client.destroy();}};
}

export function manualReportImageSettings(env) {
  if(env.ATLAS_MANUAL_REPORT_IMAGES_ENABLED!=='true')return null;
  const concurrency=Number(env.ATLAS_MANUAL_REPORT_IMAGES_CONCURRENCY??2);
  const apiKey=env.ATLAS_MANUAL_REPORT_IMAGES_OPENAI_KEY??env.ATLAS_MANUAL_OPENAI_KEY;
  requireThat(Number.isInteger(concurrency)&&concurrency>=1&&concurrency<=8
    &&typeof apiKey==='string'&&apiKey.length>=12&&!/[\r\n]/.test(apiKey),503,'REPORT_IMAGE_CONFIG_INVALID');
  return {concurrency,apiKey};
}
