import { createReportImageProvider } from '@atlas/connected-manual/report-image-provider';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { createPhotoStorage } from '@atlas/photo-storage';
import { createManualArtifactStore,createS3ManualArtifactTransport } from '@atlas/manual-service/artifacts';
import { createDurableStaffBoundary } from '@atlas/manual-service/staff-auth';
import { createMachineStaffBoundary } from '@atlas/manual-service/machine-auth';
import { createConnectedManual, createWorkLimiter } from '@atlas/connected-manual';
import { geometryProcessingEnvironment } from '@atlas/connected-manual/geometry-processing';
import { createConnectedHandler } from '@atlas/connected-manual/http';
import { createLabelExportStorage } from '@atlas/connected-manual/label-export-storage';
import { identificationEffects } from '@atlas/connected-manual/identification';
import { createAstraDefectProvider } from '@atlas/defect-analysis/provider';
import { requireThat } from '@atlas/manual-service/contract';
import { descriptorSha256 } from '@atlas/photo-core';
import { createApprovedManualReader } from '@atlas/connected-manual/publication-reader';
import { createSoldReferenceProvider } from '@atlas/connected-manual/presentation-market-provider';
import { createStationSigner } from '@atlas/connected-manual/finishing-station-protocol';
import { manualResearchSettings, manualDealerConfigurationLoader } from './market-runtime-settings.mjs';
import { createDealerStaffService } from '../../../../packages/atlas-connected-manual/src/dealer-operations.mjs';
import { variantReviewSettings, validateVariantRuntimeConfiguration } from './variant-runtime-settings.mjs';
import { createVariantCatalogService } from '../../../../packages/atlas-connected-manual/src/variant-catalog.mjs';
import { createVariantListingProvider } from '../../../../packages/atlas-connected-manual/src/variant-listing-provider.mjs';
import { createMarketSlabLabeler } from '../../../../packages/atlas-connected-manual/src/market-slab-labels.mjs';
import { createOrderDeskService } from '../../../../packages/atlas-connected-manual/src/order-desk.mjs';
import { createOrderDeskInboxService } from '../../../../packages/atlas-connected-manual/src/order-desk-inbox.mjs';
import { createOrderDeskPhotoReader } from '../../../../packages/atlas-connected-manual/src/order-desk-photos.mjs';
import { orderDeskPhotoSettings, validateOrderDeskConfiguration } from './order-desk-runtime-settings.mjs';

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

export async function validateMarketRuntimeConfiguration({marketAutomaticEnabled,client}) {
  if(!marketAutomaticEnabled)return;
  const [installed]=await client.$queryRawUnsafe("SELECT to_regclass('atlas_manual_connected.market_job') IS NOT NULL AS installed");
  requireThat(installed?.installed===true,503,'MARKET_QUEUE_SCHEMA_REQUIRED');
  const [grants]=await client.$queryRawUnsafe("SELECT has_table_privilege(current_user,'atlas_manual_connected.market_job','SELECT') AND has_table_privilege(current_user,'atlas_manual_connected.market_job','INSERT') AND (SELECT bool_and(has_column_privilege(current_user,'atlas_manual_connected.market_job',c,'UPDATE')) FROM unnest(ARRAY['state','attempts','recoveries','claim_id','lease_until','dispatch_id','public_hash','response','response_hash','code','available_at','updated_at','audit']) c) AS allowed");
  requireThat(grants?.allowed===true,503,'MARKET_QUEUE_GRANTS_REQUIRED');
}

// Runtime roles deliberately cannot read the schema-owner migration ledger.
// Verify the exact005 function bodies and both enabled table triggers through
// pg_catalog before the private host listens or starts removal admission.
export async function validateReportImageRuntimeConfiguration({enabled,client}) {
  if(!enabled)return;
  const [schema]=await client.$queryRawUnsafe(`SELECT
    current_setting('session_replication_role')='origin'
    AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('atlas_manual_connected.report_image_guard()')
      AND p.prorettype='trigger'::regtype AND NOT p.prosecdef
      AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql')
      AND p.proconfig=ARRAY['search_path=pg_catalog']::text[]
      AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='722ae9f407ca348ea509e2ece684b0d961385cd1dcb8d036ba3522016775a732')
    AND EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=to_regprocedure('atlas_manual_connected.retry_report_image(uuid,integer,uuid,uuid,uuid,text,text,uuid,text)')
      AND p.prorettype='jsonb'::regtype AND p.prosecdef
      AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql')
      AND p.proconfig=ARRAY['search_path=pg_catalog']::text[]
      AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='4d71ba973fe521b05dcce6f52d2797e207533485c588dd0d75790a12311e70bc')
    AND (SELECT count(*)=2 FROM pg_trigger t
      WHERE t.tgrelid=to_regclass('atlas_manual_connected.report_image_job')
      AND t.tgfoid=to_regprocedure('atlas_manual_connected.report_image_guard()')
      AND NOT t.tgisinternal AND t.tgenabled='O' AND t.tgqual IS NULL AND t.tgnargs=0
      AND ((t.tgname='report_image_provider_admission' AND t.tgtype=7)
        OR (t.tgname='report_image_guard' AND t.tgtype=27))) AS installed`);
  requireThat(schema?.installed===true,503,'REPORT_IMAGE_SCHEMA_REQUIRED');
}

export function manualLabelSheetsEnabled(env) {
  return env.ATLAS_MANUAL_LABEL_SHEETS_ENABLED==='true' && env.ATLAS_VARIANT_WORKER_ENABLED!=='true';
}
export async function validateLabelRuntimeConfiguration({enabled,client}) {
  if(!enabled)return;
  const [schema]=await client.$queryRawUnsafe("SELECT bool_and(to_regclass('atlas_manual_connected.'||name) IS NOT NULL) AS installed FROM unnest(ARRAY['label_item','label_sheet','label_export','label_print_event']) name");
  requireThat(schema?.installed===true,503,'LABEL_SCHEMA_REQUIRED');
  const [grants]=await client.$queryRawUnsafe("SELECT bool_and(has_table_privilege(current_user,'atlas_manual_connected.'||name,'SELECT') AND has_table_privilege(current_user,'atlas_manual_connected.'||name,'INSERT')) AND has_sequence_privilege(current_user,'atlas_manual_connected.label_sheet_number_seq','USAGE') AS allowed FROM unnest(ARRAY['label_item','label_sheet','label_export','label_print_event']) name");
  requireThat(grants?.allowed===true,503,'LABEL_GRANTS_REQUIRED');
  for(const [table,columns] of Object.entries({
    label_item:['state','snapshot','snapshot_hash','print_svg','preview_svg','artwork_hash','renderer_profile_hash','material_profile_id','jig_hash','sheet_id','slot','previous_assignment','claim_id','lease_until','attempts','code','updated_at'],
    label_sheet:['state','revision','manifest','manifest_hash','sealed_at'],
    label_export:['state','object_ref','sha256','byte_count','mapping','content_type','claim_id','lease_until','attempts','attempt_base','retry_requests','code','ready_at'],
  })) {
    const [found]=await client.$queryRawUnsafe("SELECT bool_and(has_column_privilege(current_user,$1,c,'UPDATE')) AS allowed FROM unnest($2::text[]) c",`atlas_manual_connected.${table}`,columns);
    requireThat(found?.allowed===true,503,'LABEL_GRANTS_REQUIRED');
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
  const labelSheetsEnabled=manualLabelSheetsEnabled(env);
  const baseLabelStorage=labelSheetsEnabled?createLabelExportStorage({client,bucket:settings.bucket,keyPrefix:`${settings.keyPrefix}/label-exports`}):null;
  const labelStorage=baseLabelStorage?{...baseLabelStorage,async download(...args){
    const result=await baseLabelStorage.download(...args);
    requireThat(new URL(result.url).origin===settings.uploadOrigin,503,'MANUAL_UPLOAD_ORIGIN_MISMATCH');return result;
  }}:null;
  const artifactClient={send:(command,options={})=>client.send(command,{...options,abortSignal:options.abortSignal?AbortSignal.any([options.abortSignal,AbortSignal.timeout(90000)]):AbortSignal.timeout(90000)})};
  const artifacts=createManualArtifactStore({transport:createS3ManualArtifactTransport({client:artifactClient,bucket:settings.bucket,PutObjectCommand,GetObjectCommand}),prefix:`${settings.keyPrefix}/artifacts`});
  const effects=env.ATLAS_MANUAL_IDENTIFICATION_ENABLED==='true'?identificationEffects({openaiKey:env.ATLAS_MANUAL_OPENAI_KEY,googleKey:env.ATLAS_MANUAL_GOOGLE_VISION_KEY}):null;
  const reads=new Map();
  const imageReadUrl=async({kind,descriptor,photo,photoSource,contextOnly=false})=>{
    const key=`${kind}:${contextOnly}:${descriptorSha256(descriptor)}`,cached=reads.get(key);
    if(cached&&cached.expires>Date.now())return cached.value;
    let value;
    if(kind==='original')requireThat([1,2,3,4].includes(descriptor.schemaVersion),503,'GRADING_IMAGE_REQUIRED');
    value=kind==='original'?await storage.createDecodedFrameRead({frame:descriptor,original:photo.original,decodePlan:photo.decodePlan,expiresIn:300})
      :await storage.createImmutableDerivativeRead({descriptor,frame:photo.workingFrame,original:photo.original,decodePlan:photo.decodePlan,expiresIn:300});
    for(const grant of [value,value.preview,value.display,value.display?.preview])if(grant?.url)
      requireThat(new URL(grant.url).origin===settings.uploadOrigin,503,'MANUAL_UPLOAD_ORIGIN_MISMATCH');
    value={...value,...descriptor.raster.dimensions,descriptorSha256:descriptorSha256(descriptor)};
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
  const variantConfig=variantReviewSettings(env);
  const variantCache={get:key=>connected.variantJobs.cache.get(key),getRetained:(key,sha)=>connected.variantJobs.cache.getRetained(key,sha),
    put:()=>{throw new Error('Serving reads cannot write variant source cache');}};
  // This provider has no credential or network capability. Saved references
  // remain readable after a cache TTL without acquiring or purchasing anything.
  const variantListings=variantConfig?createVariantListingProvider({cache:variantCache,
    fetchImpl:()=>{throw new Error('Serving reads cannot fetch variant listings');}}):null;
  const variantCatalog=variantConfig?createVariantCatalogService({
    scrydex:variantConfig.scrydex,cache:variantCache,listingProvider:variantListings}):null;
  const dealerOperations=env.ATLAS_MANUAL_DEALER_OPERATIONS_ENABLED==='true'?createDealerStaffService({auth,boundary}):null;
  const orderPhotoSettings=orderDeskPhotoSettings(env);
  const orderPhotoClient=orderPhotoSettings?new S3Client({region:orderPhotoSettings.region,endpoint:orderPhotoSettings.endpoint,maxAttempts:1,
    credentials:{accessKeyId:env.ATLAS_CUSTOMER_STORAGE_ACCESS_KEY,secretAccessKey:env.ATLAS_CUSTOMER_STORAGE_SECRET_KEY}}):null;
  const orderPhotos=orderPhotoClient?createOrderDeskPhotoReader({storage:createPhotoStorage({client:orderPhotoClient,bucket:orderPhotoSettings.bucket,keyPrefix:'atlas-customer',
    limits:{maxObjectBytes:256*1024*1024,timeoutMs:90000}}),limited:createWorkLimiter(1,{maxQueue:24})}):null;
  const orderDesk=dealerOperations?createOrderDeskService({auth,boundary,photos:orderPhotos}):null;
  const orderDeskInbox=dealerOperations?createOrderDeskInboxService({auth,boundary}):null;
  const marketAutomaticEnabled=env.ATLAS_MANUAL_MARKET_AUTOMATIC_ENABLED==='true';
  const marketLabeler=marketAutomaticEnabled&&marketProvider?createMarketSlabLabeler({boundary,apiKey:env.ATLAS_MANUAL_OPENAI_KEY}):null;
  const marketConcurrency=Number(env.ATLAS_MANUAL_MARKET_CONCURRENCY??2);
  requireThat(!marketAutomaticEnabled||Number.isInteger(marketConcurrency)&&marketConcurrency>=1&&marketConcurrency<=16,503,'MARKET_WORKER_CONFIG_INVALID');
  const connected=createConnectedManual({orderDesk,orderDeskInbox,variantReviewEnabled:Boolean(variantConfig),variantReadReferenceImage:variantCatalog?.readImage,marketAutomaticEnabled,marketConcurrency,marketLabeler,displayEnabled:env.ATLAS_MANUAL_REVIEW_DELIVERY_ENABLED==='true',learningEnabled:env.ATLAS_MANUAL_LEARNING_LIFECYCLE_ENABLED==='true',dealerOperations,memoryEnabled,defectProvider,batchEnabled,presentationEnabled,reportImageProvider,reportImageConcurrency:reportImageSettings?.concurrency,marketProvider,dealerConfiguration,researchConfig,stationConfig,boundary,storage,artifacts,keyPrefix:settings.keyPrefix,pythonExecutable:settings.pythonExecutable,effects,receiptClient:manualClient,imageReadUrl,
    labelStorage,readOnlyGradingImages:env.ATLAS_VARIANT_WORKER_ENABLED==='true',processing:manualProcessingSettings(env),onWorkerError});
  const handler=createConnectedHandler({connected,boundary,origin:staffConfig.origin,assertRequest});
  // Give the private host only GET reconciliation capabilities for its worker.
  // Construction is cold: no database scan or provider request starts here.
  const analysisReconciler=connected.assistance.executor?Object.freeze({
    pending:input=>connected.assistance.executor.pending(input),
    reconcile:input=>connected.assistance.executor.reconcile(input),
  }):null;
  const approvedManualReader=createApprovedManualReader({client:manualClient,artifacts,storage,presentationEnabled,reportImages:connected.reportImages,dealerOffers:connected.dealerOffers});
  const validateConfiguration=async()=>{
    await validateReportImageRuntimeConfiguration({enabled:Boolean(reportImageSettings),client:manualClient});
    await validateOrderDeskConfiguration({enabled:Boolean(orderDesk),client:manualClient});
    await validateLearningRuntimeConfiguration({memoryEnabled,learningEnabled:env.ATLAS_MANUAL_LEARNING_LIFECYCLE_ENABLED==='true',client:manualClient});
    await validateMarketRuntimeConfiguration({marketAutomaticEnabled,client:manualClient});
    await validateLabelRuntimeConfiguration({enabled:labelSheetsEnabled,client:manualClient});
    await validateVariantRuntimeConfiguration({enabled:Boolean(variantConfig),client:manualClient,worker:env.ATLAS_VARIANT_WORKER_ENABLED==='true'});
  };
  return {connected,boundary,handler,analysisReconciler,approvedManualReader,validateConfiguration,uploadOrigin:settings.uploadOrigin,async close(){await Promise.all([connected.labelWorker?.stop(),connected.ingestion?.stop(),connected.batch?.worker.stop(),connected.reportImages?.stop(),connected.marketWorker?.stop(),connected.learning?.stop()]);await manualClient.$disconnect();client.destroy();orderPhotoClient?.destroy();}};
}

export function manualReportImageSettings(env) {
  if(env.ATLAS_MANUAL_REPORT_IMAGES_ENABLED!=='true')return null;
  const concurrency=Number(env.ATLAS_MANUAL_REPORT_IMAGES_CONCURRENCY??2);
  const apiKey=env.ATLAS_PHOTOROOM_API_KEY;
  requireThat(Number.isInteger(concurrency)&&concurrency>=1&&concurrency<=8
    &&typeof apiKey==='string'&&apiKey.length>=12&&apiKey.length<=4096&&!/[\s\x00-\x1f\x7f]/.test(apiKey)
    &&apiKey!==env.ATLAS_MANUAL_OPENAI_KEY,503,'REPORT_IMAGE_CONFIG_INVALID');
  return {concurrency,apiKey};
}
