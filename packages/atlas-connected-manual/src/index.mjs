import {createVariantJobStore} from './variant-job-store.mjs';
import {createVariantReviewService} from './variant-service.mjs';
import { createMarketJobStore, recordApprovalMarket } from './market-job-store.mjs';
import { createMarketWorker } from './market-worker.mjs';
import { createReportImageStore } from './report-image-store.mjs';
import { createReportImages } from './report-images.mjs';
import { createReviewDisplay } from './review-display.mjs';
import { createReviewDisplayStore } from './review-display-store.mjs';
import { createThumbnailReader } from './thumbnails.mjs';
import { createManualIntake } from '@atlas/manual-intake';
import { createIntakeRepository } from '@atlas/manual-intake/repository';
import { createIntakeIngestionRepository, createIntakeIngestionWorker } from '@atlas/manual-intake/ingestion';
import { createPhotoProcessor } from '@atlas/manual-intake/photo-processing';
import { createManualRepository } from '@atlas/manual-service/repository';
import { createManualWorkflow } from '@atlas/manual-workflow';
import { createGeometryWorkspace, replaceGeometryImage, geometryBase, canDetectMissingPhysical } from '@atlas/manual-workspace/geometry-actions';
import { proposePhysicalGeometry, prepareGeometry, describePreparationDerivative, describePreparationPreview, adoptGeometryPreparation, adoptPhysicalGeometryProposal } from '@atlas/preparation-runtime';
import { canonical, digest, requireThat } from '@atlas/manual-service/contract';
import { createDetailsStore, gradingIdentity, geometrySideSettings } from './details.mjs';
import { createIdentification } from './identification.mjs';
import { createDefectImageEffects } from './defect-images.mjs';
import { createDefectAssistance, compatibleDefectAnalysis } from './defect-assistance.mjs';
import { measureDefectWorkspaceEdit } from '@atlas/measurement-runtime';
import { validateConfirmationCommit } from './confirmation-fence.mjs';
import { createImageDescriptors } from './image-descriptors.mjs';
import { createEarlyGeometryStore, recordEarlyGeometryIntent } from './early-geometry-store.mjs';
import { createEarlyGeometry, adoptEarlyGeometry } from './early-geometry.mjs';
import { createNativeGeometryLearning, readNativeGeometryAdvice } from './geometry-learning.mjs';
import { createPublicationRepository } from './publication-repository.mjs';
import { createManualPublication } from './publication.mjs';
import { createBatchGrading, createBatchWorker, batchActionId } from '@atlas/batch-grading';
import { createBatchRepository, recordBatchPreparedPair } from '@atlas/batch-grading/repository';
import { createBatchPreparation } from './batch-preparation.mjs';
import { createBatchReportProcess } from './batch-report-process.mjs';
import { createBatchReview } from './batch-review.mjs';
import { createManualFinishing } from './finishing.mjs';
import { createPresentationRepository } from './presentation-repository.mjs';
import { createPresentationService } from './presentation.mjs';
import { createPresentationMarketService } from './presentation-market-service.mjs';
import { createDealerOfferService } from './dealer-offers.mjs';
import { createAtlasResearchService } from './research-service.mjs';
import { createFinishingStationRepository } from './finishing-station-repository.mjs';
import { createFinishingStationService } from './finishing-station-service.mjs';
import { createConnectedCardReader } from './card-reader.mjs';
import { createMachineBatchSnapshot } from './batch-snapshot.mjs';
export { createReviewDisplay } from './review-display.mjs';

export const DEFAULT_LIMITS = Object.freeze({
  decode:{maxInputBytes:256*1024*1024,maxPixels:52_000_000,maxRasterBytes:512*1024*1024,maxOutputBytes:256*1024*1024,timeoutMs:90000},
  preparation:{maxInputBytes:256*1024*1024,maxPixels:52_000_000,maxOutputBytes:64*1024*1024,timeoutMs:90000},
  measurement:{maxInputBytes:16*1024*1024,maxOutputBytes:16*1024*1024,maxFindings:200,timeoutMs:90000},
});
const SIDES=['FRONT','BACK'];
// Bound CPU/native resource concurrency, independently of card count or spend.
export function createWorkLimiter(maximum=2,{maxQueue=0}={}){
  requireThat(Number.isInteger(maximum)&&maximum>=1&&maximum<=32&&Number.isInteger(maxQueue)&&maxQueue>=0&&maxQueue<=256,500,'MANUAL_PROCESSING_CONFIG_INVALID');
  let active=0;const waiting=[];
  return async work=>{
    if(active>=maximum){requireThat(waiting.length<maxQueue,503,'MANUAL_PROCESSING_BUSY');await new Promise(resolve=>waiting.push(resolve));}
    else active++;
    try{return await work();}finally{const next=waiting.shift();if(next)next();else active--;}
  };
}
export function createConnectedManual({boundary,storage,artifacts,keyPrefix,pythonExecutable,effects=null,receiptClient=null,imageReadUrl=null,displayEnabled=false,limits=DEFAULT_LIMITS,basePath='/admin',memoryEnabled=false,learningEnabled=false,defectProvider=null,batchEnabled=false,presentationEnabled=false,marketProvider=null,marketAutomaticEnabled=false,marketConcurrency=2,variantReviewEnabled=false,variantReadReferenceImage=null,dealerConfiguration=null,researchConfig=null,stationConfig=null,dealerOperations=null,orderDesk=null,orderDeskInbox=null,reportImageProvider=null,reportImageConcurrency=2,
  processing={nativeConcurrency:2,verificationConcurrency:4,executionConcurrency:20,analysisConcurrency:64},onWorkerError=()=>{}}) {
  let earlyGeometry,batch=null,variantReview=null;
  requireThat(!batchEnabled || memoryEnabled && defectProvider,503,'BATCH_ANALYSIS_REQUIRED');
  const autonomous=batchEnabled&&typeof boundary.machineTransaction==='function';
  const intakeRepository=createIntakeRepository({boundary,keyPrefix,maxOriginalBytes:64*1024*1024,sourceCommitted:recordEarlyGeometryIntent,
    pairCommitted:autonomous?recordBatchPreparedPair:null,includeIngestionStatus:autonomous});
  const limited=createWorkLimiter(processing.nativeConcurrency,{maxQueue:64}),photoProcessor=createPhotoProcessor({storage,keyPrefix,decodeLimits:limits.decode});
  const intake=createManualIntake({repository:intakeRepository,storage,artifacts,processPhoto:input=>limited(()=>photoProcessor(input)),
    sourcePrepared:async(staff,cardId,uploadId)=>{
      await earlyGeometry.sourcePrepared(staff,cardId,uploadId);
      if(batch&&!autonomous){const {card}=await intake.read(staff,cardId);if(card.ready)await batch.enqueue(staff,{
        actionId:batchActionId(card.sourceHash,'ENQUEUE'),cards:[{cardId,sourceHash:card.sourceHash}]});}
    }});
  const reviewDisplay=displayEnabled?createReviewDisplay({store:createReviewDisplayStore({boundary,client:receiptClient,intakeRepository}),storage,intake,artifacts,keyPrefix,limited,
    authorityFor:job=>boundary.machineOwner({ownerId:job.owner_id,accessVersion:job.access_version}),onError:onWorkerError}):null;
  const reportImages=reportImageProvider?createReportImages({store:createReportImageStore({boundary,client:receiptClient}),storage,artifacts,provider:reportImageProvider,keyPrefix,concurrency:reportImageConcurrency,onError:onWorkerError}):null;
  const details=createDetailsStore({boundary,intakeRepository});
  earlyGeometry=createEarlyGeometry({store:createEarlyGeometryStore({boundary,intakeRepository,receiptClient}),intake,details,storage,artifacts,keyPrefix,
    limited,pythonExecutable,limits:limits.preparation,
    geometryLearning:learningEnabled?createNativeGeometryLearning({boundary,intakeRepository}):null,
    geometryConcurrency:processing.geometryConcurrency,geometryDiscoveryPageSize:processing.geometryDiscoveryPageSize});
  const identification=createIdentification({boundary,intake,intakeRepository,storage,artifacts,details,effects,receiptClient,limited});
  const variantJobs=variantReviewEnabled?createVariantJobStore({boundary,intakeRepository,analysisCompatible:async({card,run})=>compatibleDefectAnalysis(run,card,await workflow.hydrate(card))}):null;
  const validateAccess=({tx,cardId})=>intakeRepository.assertActiveInTransaction(tx,cardId);
  const publicationRepository=createPublicationRepository({boundary,validateAccess});
  const publication=createManualPublication({repository:publicationRepository,artifacts,storage,readSource:intake.readSource});
  const finishing=createManualFinishing({repository:publicationRepository,artifacts});
  const station=stationConfig?createFinishingStationService({...stationConfig,finishing,repository:createFinishingStationRepository({boundary,validateAccess})}):null;
  const presentationRepository=presentationEnabled?createPresentationRepository({boundary,keyPrefix,validateAccess}):null;
  const presentation=presentationEnabled?createPresentationService({repository:presentationRepository,storage,processPhoto:photoProcessor,keyPrefix,run:limited}):null;
  requireThat(!marketAutomaticEnabled || presentationEnabled && marketProvider && typeof boundary.machineTransaction==='function',503,'MARKET_AUTOMATIC_CONFIGURATION_INVALID');
  const marketJobs=marketAutomaticEnabled?createMarketJobStore({boundary,validateAccess}):null;
  const marketWorker=marketJobs?createMarketWorker({store:marketJobs,approved:finishing,publication,artifacts,provider:marketProvider,concurrency:marketConcurrency,
    authorityFor:job=>boundary.machineOwner({ownerId:job.actor_id,accessVersion:job.access_version}),onError:onWorkerError}):null;
  const market=presentationEnabled?createPresentationMarketService({repository:presentationRepository,approved:finishing,artifacts,provider:marketProvider,run:limited,jobs:marketJobs,worker:marketWorker}):null;
  requireThat(!researchConfig || presentationEnabled && marketProvider,503,'RESEARCH_PRESENTATION_REQUIRED');
  const dealerOffers=presentationEnabled?createDealerOfferService({repository:presentationRepository,approved:finishing,loadConfiguration:dealerConfiguration}):null;
  const research=researchConfig?createAtlasResearchService({boundary,repository:presentationRepository,approved:finishing,intake,storage,artifacts,receiptClient,validateAccess,config:researchConfig,run:limited}):null;
  async function current(staff,card){
    const actual=(await intake.read(staff,card.cardId)).card;
    requireThat(actual.ready && actual.sourceHash===card.draft.source?.sourceHash,409,'MANUAL_PHOTOS_CHANGED');return actual;
  }
  const repository=createManualRepository({boundary,validateAccess,validateCommit: async context=>{if(memoryEnabled)await validateConfirmationCommit(context);if(variantJobs)await variantJobs.validateCommit(context);},approvalCommitted:async context=>{
    await publicationRepository.approvalCommitted(context);
    if(marketJobs)await recordApprovalMarket(context);
  },
    validateSource:async({tx,principal,cardId,draft,initial})=>{
    await intakeRepository.assertCurrentPair(tx,principal,{cardId,sourceHash:draft.source?.sourceHash});
    if(initial){const [saved]=await tx.$queryRawUnsafe('SELECT revision FROM atlas_manual_connected.details WHERE card_id=$1::uuid FOR SHARE',cardId);
      requireThat(saved?.revision===draft.source.detailsRevision,409,'MANUAL_DETAILS_STALE');}
  }});
  async function readPhoto(staff,cardId,uploadId){
    const {photo}=await intake.readSource(staff,cardId,uploadId);
    const found=await storage.readDecodedFrame({frame:photo.workingFrame,original:photo.original,decodePlan:photo.decodePlan});
    return {original:photo.original,decodePlan:photo.decodePlan,frame:photo.workingFrame,bytes:found.bytes};
  }
  async function prepared(geometry,side,source,photo){
    const result=await prepareGeometry({workspace:geometry,side,source:photo,limits:limits.preparation,pythonExecutable});
    const images={};
    for(const name of Object.keys(result.outputs)){
      const descriptor=describePreparationDerivative(result,name,photo,{id:`${result.id}:${name}`,object:{key:`${keyPrefix}/derived/${geometry.cardId}/preparation/${result.id}-${name}.webp`,versionId:null}});
      images[name]=await storage.writeDerivative({descriptor,frame:photo.frame,original:photo.original,decodePlan:photo.decodePlan,bytes:result.outputs[name].bytes});
    }
    const preview=result.inspectionPreview;
    let inspectionPreview;
    if(preview){
      const descriptor=describePreparationPreview(result,photo,{id:`${result.id}:inspection-preview`,object:{key:`${keyPrefix}/derived/${geometry.cardId}/preparation/${result.id}-inspection-preview.jpg`,versionId:null}});
      inspectionPreview={policyVersion:preview.policyVersion,sourceSha256:preview.sourceSha256,
        descriptor:await storage.writeDerivative({descriptor,frame:photo.frame,original:photo.original,decodePlan:photo.decodePlan,bytes:preview.bytes})};
    }
    const value={frameId:result.frame.id,images,identity:result.identity,encoderSettings:result.encoderSettings,...(inspectionPreview?{inspectionPreview}:{})},sourceHash=digest(JSON.stringify(value));
    const ref=await artifacts.write(value,{cardId:geometry.cardId,kind:'PREPARED_IMAGES',sourceHash});
    return {geometry:adoptGeometryPreparation(geometry,result).state,source:{...source,prepared:{...source.prepared,[side]:{ref,sourceHash}}}};
  }
  async function build(staff,cardId,settings,pair,previous=null){
    const source={sourceHash:pair.sourceHash,uploads:Object.fromEntries(SIDES.map(side=>[side,pair.sides[side].upload.uploadId])),prepared:{FRONT:null,BACK:null}};
    let packet={source,geometry:createGeometryWorkspace({cardId,profile:settings.profile,sides:Object.fromEntries(SIDES.map(side=>{
      const photo=pair.sides[side].photo,raster=photo.workingFrame.raster;
      return [side,{image:{version:photo.original.binding.version,originalSha256:photo.original.content.sha256,frameId:photo.workingFrame.id,
        frameSha256:raster.content.sha256,width:raster.dimensions.width,height:raster.dimensions.height,coordinateSpace:'ORIENTED_DECODED'},...geometrySideSettings(settings,side)}];
    }))})};
    const changedSides=previous?SIDES.filter(side=>previous.source.uploads[side]!==source.uploads[side]):SIDES;
    if(previous){
      const fresh=packet.geometry;packet.geometry=previous.geometry;
      packet.source.prepared={...previous.source.prepared};
      for(const side of changedSides){packet.geometry=replaceGeometryImage(packet.geometry,{side,base:geometryBase(packet.geometry,side,'IMAGE'),image:fresh.sides[side].image}).state;packet.source.prepared[side]=null;}
    }
    await earlyGeometry.ensure(staff,cardId,{},Object.fromEntries(SIDES.map(side=>[side,packet.geometry.sides[side]])));
    for(const side of changedSides){
      const cached=await earlyGeometry.consume(staff,cardId,side,pair.sides[side].upload,pair.sides[side].photo,packet.geometry.sides[side]);
      if(!cached.packet)continue;
      const adopted=adoptEarlyGeometry(packet.geometry,side,cached.packet,cached.input);
      packet.geometry=adopted.geometry;packet.source.prepared[side]=adopted.prepared;
    }
    return {...packet,changedSides};
  }
  let assistance, batchReview;
  const workflow=createManualWorkflow({repository,artifacts,pythonExecutable,measurementLimits:limits.measurement,
    resolveProposal: input => assistance.resolveProposal(input),
    resolveVariantConfirmation: input=>{requireThat(variantReview,503,'VARIANT_DISABLED');return variantReview.resolve(input);},
    prepareVariantConfirmation: input=>variantJobs?.prepareConfirmation(input)??null,
    resolveFinalReview: input => { requireThat(batchReview,503,'BATCH_DISABLED'); return batchReview.resolveCorrections(input); },
    resolveConfirmation: input => assistance.resolveConfirmation(input),
    assertReviewComplete: async input => {
      const confirmation = variantJobs ? await variantJobs.currentConfirmation(input.staff, input.card) : null;
      if (confirmation?.reprocess_required) await assistance.assertVariantAnalysis({ ...input, analysisActionId: confirmation.analysis_action_id });
      return assistance.assertReviewComplete(input);
    },
    afterConfirm: memoryEnabled ? (staff,cardId,actionId)=>assistance.publish(staff,cardId,actionId) : null,
    afterApprove: async (staff,cardId,actionId)=>{
      try { return await publication.publish(staff,cardId,actionId); }
      finally { void marketWorker?.wake(); }
    },
    measure:input=>limited(()=>measureDefectWorkspaceEdit(input)),
    assertCurrent:({card,staff})=>current(staff,card),
    prepare:({geometry,side,source,staff})=>limited(async()=>{
      await current(staff,{cardId:geometry.cardId,draft:{source}});
      const photo=await readPhoto(staff,geometry.cardId,source.uploads[side]);
      if(!geometry.sides[side].physical){
        requireThat(canDetectMissingPhysical(geometry,side),409,'MANUAL_GEOMETRY_RECOVERY_UNAVAILABLE');
        const proposal=await proposePhysicalGeometry({workspace:geometry,side,source:photo,limits:limits.preparation,pythonExecutable});
        const adoption=adoptPhysicalGeometryProposal(geometry,proposal);
        requireThat(adoption.proposalApplied,422,'MANUAL_PHYSICAL_DETECTION_UNAVAILABLE');
        geometry=adoption.state;
      }
      return prepared(geometry,side,source,photo);
    }),
    replaceSources:async({card,geometry,sourceHash,staff})=>{
      const pair=await intake.verifiedPair(staff,card.cardId);requireThat(pair.sourceHash===sourceHash,409,'MANUAL_PHOTOS_CHANGED');
      return build(staff,card.cardId,{profile:geometry.profile,cornerShape:geometry.sides.FRONT.cornerShape,matColor:geometry.sides.FRONT.matColor},pair,{geometry,source:card.draft.source});
    },
  });
  async function manifest(card,side){const stored=card.draft.source.prepared[side];return stored?artifacts.read(stored.ref,{cardId:card.cardId,kind:'PREPARED_IMAGES',sourceHash:stored.sourceHash}):null;}
  const imageUrl=(cardId,side,kind,hash)=>`${basePath}/api/staff/manual-connected/cards/${cardId}/images/${side}/${kind}/${hash}`;
  const imageDescriptors=createImageDescriptors({current,readSource:intake.readSource,readManifest:manifest,imageReadUrl,imageUrl,reviewDisplay});
  async function readPrepared(staff,card,side,kind){
    await current(staff,card);
    const saved=await manifest(card,side),descriptor=saved?.images?.[kind];
    const state=await workflow.hydrate(card);
    requireThat(descriptor && state.geometry.sides[side].prepared?.frame.id===saved.frameId,409,'MANUAL_IMAGE_BINDING_INVALID');
    const {photo}=await intake.readSource(staff,card.cardId,card.draft.source.uploads[side]);
    const found=await storage.readDerivative({descriptor,frame:photo.workingFrame,original:photo.original,decodePlan:photo.decodePlan});
    await current(staff,card);return found;
  }
  const imageEffects=createDefectImageEffects({readPrepared,artifacts,limited});
  assistance=createDefectAssistance({boundary,intakeRepository,workflow,artifacts,imageEffects,memoryEnabled,learningEnabled,provider:defectProvider,receiptClient,onWorkerError});
  variantReview=variantJobs?createVariantReviewService({store:variantJobs,workflow,readReferenceImage:variantReadReferenceImage}):null;
  const connected={variantReview,variantJobs,dealerOperations,orderDesk,orderDeskInbox,marketWorker,marketJobs,reportImages,reviewDisplay,boundary,intake,intakeRepository,details,identification,workflow,imageDescriptors,assistance,learning:assistance.learning,earlyGeometry,publication,finishing,presentation,market,dealerOffers,research,station,
    workspaceExtras: async input => {
      const [extras,status,geometryLearning]=await Promise.all([assistance.workspaceExtras(input),publication.status(input.staff,input.card.cardId),
        learningEnabled?readNativeGeometryAdvice({boundary,earlyGeometry,staff:input.staff,cardId:input.card.cardId}).catch(error=>{
          if([401,403].includes(error?.status))throw error;onWorkerError({code:'GEOMETRY_LEARNING_UNAVAILABLE'});return null;
        }):null]);
      return {...extras,...(variantReview?{variantVerification:await variantReview.status(input.staff,input.card.cardId)}:{}),...(geometryLearning?{geometryLearning}:{}),publication:status,provisional:workflow.currentPreview(input.card,input.state),presentationEnabled,marketEnabled:Boolean(marketProvider),marketAutomaticEnabled:Boolean(marketJobs),researchEnabled:Boolean(research),catalogEnabled:Boolean(researchConfig?.catalogToken)};
    },
    thumbnails:createThumbnailReader({intake,workflow,readManifest:manifest,imageReadUrl,reviewDisplay}),
    open:createConnectedCardReader({intake,details,workflow,identification,earlyGeometry,imageReadUrl}),
    machineBatchSnapshot:createMachineBatchSnapshot({intakeRepository,workflow,details,identification}),
    async initialize(staff,cardId,input){
      requireThat(input && Object.keys(input).length===2 && /^[a-f0-9]{64}$/.test(input.sourceHash) && Number.isSafeInteger(input.detailsRevision));
      const pair=await intake.verifiedPair(staff,cardId),saved=await details.read(staff,cardId);
      requireThat(pair.sourceHash===input.sourceHash && saved.revision===input.detailsRevision,409,'MANUAL_DETAILS_STALE');
      const identity=gradingIdentity(saved.details);
      try{const existing=await workflow.service.read(staff,cardId);await current(staff,existing);return {card:existing};}
      catch(error){if(error?.code!=='MANUAL_CARD_NOT_FOUND')throw error;}
      const packet=await build(staff,cardId,saved.details,pair);
      // A details edit during CPU preparation cannot be silently overwritten.
      requireThat((await details.read(staff,cardId)).revision===saved.revision,409,'MANUAL_DETAILS_STALE');
      return {card:await workflow.provision(staff,{...packet,source:{...packet.source,detailsRevision:saved.revision},identity})};
    },
    async image(staff,cardId,side,kind,hash){
      requireThat(SIDES.includes(side),404,'MANUAL_IMAGE_NOT_FOUND');
      const card=await workflow.service.read(staff,cardId);await current(staff,card);
      const {photo}=await intake.readSource(staff,cardId,card.draft.source.uploads[side]);
      let found;
      if(kind==='original'){
        requireThat(photo.workingFrame.raster.content.sha256===hash,404,'MANUAL_IMAGE_NOT_FOUND');
        found=await storage.readDecodedFrame({frame:photo.workingFrame,original:photo.original,decodePlan:photo.decodePlan});
      }else{
        const saved=await manifest(card,side),descriptor=saved?.images?.[kind];
        const state=await workflow.hydrate(card);requireThat(descriptor && state.geometry.sides[side].prepared?.frame.id===saved.frameId && descriptor.raster.content.sha256===hash,404,'MANUAL_IMAGE_NOT_FOUND');
        found=await storage.readDerivative({descriptor,frame:photo.workingFrame,original:photo.original,decodePlan:photo.decodePlan});
      }
      await current(staff,card);return {bytes:found.bytes,contentType:found.contentType};
    },
    async intakeImage(staff,cardId,side){const {card}=await intake.read(staff,cardId);const upload=card.sides[side]?.upload;requireThat(upload?.source,404,'MANUAL_IMAGE_NOT_FOUND');
      const {photo}=await intake.readSource(staff,cardId,upload.uploadId);const found=await storage.readDecodedFrame({frame:photo.workingFrame,original:photo.original,decodePlan:photo.decodePlan});
      requireThat((await intake.read(staff,cardId)).card.sides[side]?.upload?.uploadId===upload.uploadId,409,'MANUAL_PHOTOS_CHANGED');
      return {bytes:found.bytes,contentType:found.contentType};},
  };
  if(batchEnabled){
    const batchRepository=createBatchRepository({boundary,intakeRepository});
    const prepare=createBatchPreparation({connected,artifacts,pythonExecutable,measurementLimits:limits.measurement,
      reportBuilder:createBatchReportProcess({limited})});
    batchReview=createBatchReview({connected,repository:batchRepository,artifacts});
    batch=createBatchGrading({repository:batchRepository,worker:createBatchWorker({repository:batchRepository,prepare,
      concurrency:processing.executionConcurrency,analysisConcurrency:processing.analysisConcurrency,onError:onWorkerError,autoStart:false}),
      review:batchReview,
      intakeStatus:autonomous?async staff=>(await intake.processingList(staff,{limit:100})).cards:null});
  }
  connected.batch=batch;
  connected.ingestion=autonomous?createIntakeIngestionWorker({repository:createIntakeIngestionRepository({boundary}),intake,
    authorityFor:job=>boundary.machineOwner({ownerId:job.ownerId,accessVersion:job.accessVersion}),
    verificationConcurrency:processing.verificationConcurrency,preparationConcurrency:processing.nativeConcurrency,onError:onWorkerError}):null;
  return Object.freeze(connected);
}
