import { createManualIntake } from '@atlas/manual-intake';
import { createIntakeRepository } from '@atlas/manual-intake/repository';
import { createPhotoProcessor } from '@atlas/manual-intake/photo-processing';
import { createManualRepository } from '@atlas/manual-service/repository';
import { createManualWorkflow } from '@atlas/manual-workflow';
import { createGeometryWorkspace, replaceGeometryImage, geometryBase, canDetectMissingPhysical } from '@atlas/manual-workspace/geometry-actions';
import { proposePhysicalGeometry, prepareGeometry, describePreparationDerivative, adoptGeometryPreparation, adoptPhysicalGeometryProposal } from '@atlas/preparation-runtime';
import { canonical, digest, requireThat } from '@atlas/manual-service/contract';
import { createDetailsStore, gradingIdentity } from './details.mjs';
import { createIdentification } from './identification.mjs';
import { createDefectImageEffects } from './defect-images.mjs';
import { createDefectAssistance } from './defect-assistance.mjs';
import { measureDefectWorkspaceEdit } from '@atlas/measurement-runtime';
import { validateConfirmationCommit } from './confirmation-fence.mjs';
import { createImageDescriptors } from './image-descriptors.mjs';
import { createEarlyGeometryStore, recordEarlyGeometryIntent } from './early-geometry-store.mjs';
import { createEarlyGeometry, adoptEarlyGeometry } from './early-geometry.mjs';
import { createPublicationRepository } from './publication-repository.mjs';
import { createManualPublication } from './publication.mjs';
import { createBatchGrading, createBatchWorker, batchActionId } from '@atlas/batch-grading';
import { createBatchRepository } from '@atlas/batch-grading/repository';
import { createBatchPreparation } from './batch-preparation.mjs';
import { createBatchReview } from './batch-review.mjs';
import { createManualFinishing } from './finishing.mjs';
import { createPresentationRepository } from './presentation-repository.mjs';
import { createPresentationService } from './presentation.mjs';
import { createPresentationMarketService } from './presentation-market-service.mjs';
import { createFinishingStationRepository } from './finishing-station-repository.mjs';
import { createFinishingStationService } from './finishing-station-service.mjs';

export const DEFAULT_LIMITS = Object.freeze({
  decode:{maxInputBytes:256*1024*1024,maxPixels:52_000_000,maxRasterBytes:512*1024*1024,maxOutputBytes:256*1024*1024,timeoutMs:90000},
  preparation:{maxInputBytes:256*1024*1024,maxPixels:52_000_000,maxOutputBytes:64*1024*1024,timeoutMs:90000},
  measurement:{maxInputBytes:16*1024*1024,maxOutputBytes:16*1024*1024,maxFindings:200,timeoutMs:90000},
});
const SIDES=['FRONT','BACK'];
// Bound CPU/native resource concurrency, independently of card count or spend.
export function createWorkLimiter(maximum=2){let active=0;return async work=>{
  requireThat(active<maximum,503,'MANUAL_PROCESSING_BUSY');active++;try{return await work();}finally{active--;}
};}
export function createConnectedManual({boundary,storage,artifacts,keyPrefix,pythonExecutable,effects=null,receiptClient=null,imageReadUrl=null,limits=DEFAULT_LIMITS,basePath='/admin',memoryEnabled=false,defectProvider=null,batchEnabled=false,presentationEnabled=false,marketProvider=null,stationConfig=null}) {
  let earlyGeometry,batch=null;
  requireThat(!batchEnabled || memoryEnabled && defectProvider,503,'BATCH_ANALYSIS_REQUIRED');
  const intakeRepository=createIntakeRepository({boundary,keyPrefix,maxOriginalBytes:64*1024*1024,sourceCommitted:recordEarlyGeometryIntent});
  const limited=createWorkLimiter(2),photoProcessor=createPhotoProcessor({storage,keyPrefix,decodeLimits:limits.decode});
  const intake=createManualIntake({repository:intakeRepository,storage,artifacts,processPhoto:input=>limited(()=>photoProcessor(input)),
    sourcePrepared:async(staff,cardId,uploadId)=>{
      await earlyGeometry.sourcePrepared(staff,cardId,uploadId);
      if(batch){const {card}=await intake.read(staff,cardId);if(card.ready)await batch.enqueue(staff,{
        actionId:batchActionId(card.sourceHash,'ENQUEUE'),cards:[{cardId,sourceHash:card.sourceHash}]});}
    }});
  const details=createDetailsStore({boundary,intakeRepository});
  earlyGeometry=createEarlyGeometry({store:createEarlyGeometryStore({boundary,intakeRepository,receiptClient}),intake,details,storage,artifacts,keyPrefix,
    limited,pythonExecutable,limits:limits.preparation});
  const identification=createIdentification({boundary,intake,intakeRepository,storage,artifacts,details,effects,receiptClient});
  const publicationRepository=createPublicationRepository({boundary});
  const publication=createManualPublication({repository:publicationRepository,artifacts,storage,readSource:intake.readSource});
  const finishing=createManualFinishing({repository:publicationRepository,artifacts});
  const station=stationConfig?createFinishingStationService({...stationConfig,finishing,repository:createFinishingStationRepository({boundary})}):null;
  const presentationRepository=presentationEnabled?createPresentationRepository({boundary,keyPrefix}):null;
  const presentation=presentationEnabled?createPresentationService({repository:presentationRepository,storage,processPhoto:photoProcessor,keyPrefix,run:limited}):null;
  const market=presentationEnabled?createPresentationMarketService({repository:presentationRepository,approved:finishing,artifacts,provider:marketProvider,run:limited}):null;
  async function current(staff,card){
    const actual=(await intake.read(staff,card.cardId)).card;
    requireThat(actual.ready && actual.sourceHash===card.draft.source?.sourceHash,409,'MANUAL_PHOTOS_CHANGED');return actual;
  }
  const repository=createManualRepository({boundary,validateCommit: memoryEnabled ? validateConfirmationCommit : null,approvalCommitted:publicationRepository.approvalCommitted,
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
    const value={frameId:result.frame.id,images,identity:result.identity,encoderSettings:result.encoderSettings},sourceHash=digest(JSON.stringify(value));
    const ref=await artifacts.write(value,{cardId:geometry.cardId,kind:'PREPARED_IMAGES',sourceHash});
    return {geometry:adoptGeometryPreparation(geometry,result).state,source:{...source,prepared:{...source.prepared,[side]:{ref,sourceHash}}}};
  }
  async function build(staff,cardId,settings,pair,previous=null){
    const source={sourceHash:pair.sourceHash,uploads:Object.fromEntries(SIDES.map(side=>[side,pair.sides[side].upload.uploadId])),prepared:{FRONT:null,BACK:null}};
    let packet={source,geometry:createGeometryWorkspace({cardId,profile:settings.profile,sides:Object.fromEntries(SIDES.map(side=>{
      const photo=pair.sides[side].photo,raster=photo.workingFrame.raster;
      return [side,{image:{version:photo.original.binding.version,originalSha256:photo.original.content.sha256,frameId:photo.workingFrame.id,
        frameSha256:raster.content.sha256,width:raster.dimensions.width,height:raster.dimensions.height,coordinateSpace:'ORIENTED_DECODED'},cornerShape:settings.cornerShape,matColor:settings.matColor}];
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
  let assistance;
  const workflow=createManualWorkflow({repository,artifacts,pythonExecutable,measurementLimits:limits.measurement,
    resolveProposal: input => assistance.resolveProposal(input),
    resolveConfirmation: input => assistance.resolveConfirmation(input),
    assertReviewComplete: input => assistance.assertReviewComplete(input),
    afterConfirm: memoryEnabled ? (staff,cardId,actionId)=>assistance.publish(staff,cardId,actionId) : null,
    afterApprove: (staff,cardId,actionId)=>publication.publish(staff,cardId,actionId),
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
  const imageDescriptors=createImageDescriptors({current,readSource:intake.readSource,readManifest:manifest,imageReadUrl,imageUrl});
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
  assistance=createDefectAssistance({boundary,intakeRepository,workflow,artifacts,imageEffects,memoryEnabled,provider:defectProvider,receiptClient});
  const connected={boundary,intake,intakeRepository,details,identification,workflow,imageDescriptors,assistance,earlyGeometry,publication,finishing,presentation,market,station,
    workspaceExtras: async input => {
      const [extras,status]=await Promise.all([assistance.workspaceExtras(input),publication.status(input.staff,input.card.cardId)]);
      return {...extras,publication:status,presentationEnabled,marketEnabled:Boolean(marketProvider)};
    },
    async open(staff,cardId){
      const [{card},saved]=await Promise.all([intake.read(staff,cardId),details.read(staff,cardId)]);
      let manual=null;try{manual=await workflow.service.read(staff,cardId);}catch(error){if(error?.code!=='MANUAL_CARD_NOT_FOUND')throw error;}
      const previews={};
      if(imageReadUrl)for(const side of SIDES)if(card.sides[side].upload?.source){const {photo}=await intake.readSource(staff,cardId,card.sides[side].upload.uploadId);previews[side]=await imageReadUrl({kind:'original',descriptor:photo.workingFrame,photo});}
      const identificationState=await identification.status(staff,cardId);
      const geometryState=await earlyGeometry.status(staff,cardId);
      const currentCard=(await intake.read(staff,cardId)).card;
      requireThat(currentCard.revision===card.revision&&currentCard.sourceHash===card.sourceHash,409,'MANUAL_PHOTOS_CHANGED');
      return {card,...saved,previews,manual:manual?{revision:manual.revision,current:manual.draft.source?.sourceHash===card.sourceHash}:null,
        identification:identificationState,earlyGeometry:geometryState};
    },
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
      measure:input=>limited(()=>measureDefectWorkspaceEdit(input))});
    batch=createBatchGrading({repository:batchRepository,worker:createBatchWorker({repository:batchRepository,prepare,concurrency:2}),
      review:createBatchReview({connected,repository:batchRepository,artifacts})});
  }
  connected.batch=batch;
  return Object.freeze(connected);
}
