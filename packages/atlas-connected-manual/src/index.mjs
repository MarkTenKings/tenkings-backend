import { createManualIntake } from '@atlas/manual-intake';
import { createIntakeRepository } from '@atlas/manual-intake/repository';
import { createPhotoProcessor } from '@atlas/manual-intake/photo-processing';
import { createManualRepository } from '@atlas/manual-service/repository';
import { createManualWorkflow } from '@atlas/manual-workflow';
import { createGeometryWorkspace, replaceGeometryImage, applyGeometryEdit, geometryBase } from '@atlas/manual-workspace/geometry-actions';
import { proposePhysicalGeometry, prepareGeometry, describePreparationDerivative, adoptGeometryPreparation } from '@atlas/preparation-runtime';
import { canonical, digest, requireThat } from '@atlas/manual-service/contract';
import { createDetailsStore, gradingIdentity } from './details.mjs';
import { createIdentification } from './identification.mjs';
import { createDefectImageEffects } from './defect-images.mjs';
import { createDefectAssistance } from './defect-assistance.mjs';
import { measureDefectWorkspaceEdit } from '@atlas/measurement-runtime';

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
export function createConnectedManual({boundary,storage,artifacts,keyPrefix,pythonExecutable,effects=null,receiptClient=null,imageReadUrl=null,limits=DEFAULT_LIMITS,basePath='/admin',memoryEnabled=false,defectProvider=null}) {
  const intakeRepository=createIntakeRepository({boundary,keyPrefix,maxOriginalBytes:64*1024*1024});
  const limited=createWorkLimiter(2),photoProcessor=createPhotoProcessor({storage,keyPrefix,decodeLimits:limits.decode});
  const intake=createManualIntake({repository:intakeRepository,storage,artifacts,processPhoto:input=>limited(()=>photoProcessor(input))});
  const details=createDetailsStore({boundary,intakeRepository});
  const identification=createIdentification({boundary,intake,intakeRepository,storage,artifacts,details,effects,receiptClient});
  async function current(staff,card){
    const actual=(await intake.read(staff,card.cardId)).card;
    requireThat(actual.ready && actual.sourceHash===card.draft.source?.sourceHash,409,'MANUAL_PHOTOS_CHANGED');return actual;
  }
  const repository=createManualRepository({boundary,validateSource:async({tx,principal,cardId,draft,initial})=>{
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
    for(const side of changedSides){
      const photo=await readPhoto(staff,cardId,source.uploads[side]);
      let proposal;
      try{proposal=await proposePhysicalGeometry({workspace:packet.geometry,side,source:photo,limits:limits.preparation,pythonExecutable});}
      catch(error){if(error?.name==='PreparationError')continue;throw error;}
      if(proposal.proposal?.outcome!=='ACCEPTED')continue;
      packet.geometry=applyGeometryEdit(packet.geometry,{side,kind:'PHYSICAL',base:geometryBase(packet.geometry,side,'PHYSICAL'),quad:proposal.proposal.proposal,
        actor:'ENGINE',proposal:{id:proposal.id,ambiguous:Boolean(proposal.proposal.ambiguity?.ambiguous)}}).state;
      try{packet=await prepared(packet.geometry,side,packet.source,photo);}
      catch(error){if(error?.name!=='PreparationError')throw error;}
    }
    return {...packet,changedSides};
  }
  let assistance;
  const workflow=createManualWorkflow({repository,artifacts,pythonExecutable,measurementLimits:limits.measurement,
    resolveProposal: input => assistance.resolveProposal(input),
    afterConfirm: memoryEnabled ? (staff,cardId,actionId)=>assistance.publish(staff,cardId,actionId) : null,
    measure:input=>limited(()=>measureDefectWorkspaceEdit(input)),
    assertCurrent:({card,staff})=>current(staff,card),
    prepare:({geometry,side,source,staff})=>limited(async()=>{
      await current(staff,{cardId:geometry.cardId,draft:{source}});
      return prepared(geometry,side,source,await readPhoto(staff,geometry.cardId,source.uploads[side]));
    }),
    replaceSources:({card,geometry,sourceHash,staff})=>limited(async()=>{
      const pair=await intake.verifiedPair(staff,card.cardId);requireThat(pair.sourceHash===sourceHash,409,'MANUAL_PHOTOS_CHANGED');
      return build(staff,card.cardId,{profile:geometry.profile,cornerShape:geometry.sides.FRONT.cornerShape,matColor:geometry.sides.FRONT.matColor},pair,{geometry,source:card.draft.source});
    }),
  });
  async function manifest(card,side){const stored=card.draft.source.prepared[side];return stored?artifacts.read(stored.ref,{cardId:card.cardId,kind:'PREPARED_IMAGES',sourceHash:stored.sourceHash}):null;}
  const imageUrl=(cardId,side,kind,hash)=>`${basePath}/api/staff/manual-connected/cards/${cardId}/images/${side}/${kind}/${hash}`;
  async function descriptor(staff,card,side,kind,image){
    const source=await intake.readSource(staff,card.cardId,card.draft.source.uploads[side]);
    const content=image.raster.content;
    const result=imageReadUrl?await imageReadUrl({kind,descriptor:image,photo:source.photo}):{url:imageUrl(card.cardId,side,kind,content.sha256),sha256:content.sha256,byteCount:content.byteCount,mime:content.mime};
    await current(staff,card);return result;
  }
  async function imageDescriptors({card,state,staff}){
    await current(staff,card);const images={};
    for(const side of SIDES){
      const slot=state.geometry.sides[side],saved=await manifest(card,side);
      const original=await intake.readSource(staff,card.cardId,card.draft.source.uploads[side]);
      images[side]={original:await descriptor(staff,card,side,'original',original.photo.workingFrame)};
      if(slot.prepared && saved){requireThat(saved.frameId===slot.prepared.frame.id,503,'MANUAL_IMAGE_BINDING_INVALID');
        for(const [kind,image]of Object.entries(saved.images))images[side][kind]=await descriptor(staff,card,side,kind,image);}
    }
    return images;
  }
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
  return Object.freeze({boundary,intake,intakeRepository,details,identification,workflow,imageDescriptors,assistance,
    workspaceExtras: assistance.workspaceExtras,
    async open(staff,cardId){
      const [{card},saved]=await Promise.all([intake.read(staff,cardId),details.read(staff,cardId)]);
      let manual=null;try{manual=await workflow.service.read(staff,cardId);}catch(error){if(error?.code!=='MANUAL_CARD_NOT_FOUND')throw error;}
      const previews={};
      if(imageReadUrl)for(const side of SIDES)if(card.sides[side].upload?.source){const {photo}=await intake.readSource(staff,cardId,card.sides[side].upload.uploadId);previews[side]=await imageReadUrl({kind:'original',descriptor:photo.workingFrame,photo});}
      const identificationState=await identification.status(staff,cardId);
      const currentCard=(await intake.read(staff,cardId)).card;
      requireThat(currentCard.revision===card.revision&&currentCard.sourceHash===card.sourceHash,409,'MANUAL_PHOTOS_CHANGED');
      return {card,...saved,previews,manual:manual?{revision:manual.revision,current:manual.draft.source?.sourceHash===card.sourceHash}:null,
        identification:identificationState};
    },
    async initialize(staff,cardId,input){
      requireThat(input && Object.keys(input).length===2 && /^[a-f0-9]{64}$/.test(input.sourceHash) && Number.isSafeInteger(input.detailsRevision));
      const pair=await intake.verifiedPair(staff,cardId),saved=await details.read(staff,cardId);
      requireThat(pair.sourceHash===input.sourceHash && saved.revision===input.detailsRevision,409,'MANUAL_DETAILS_STALE');
      const identity=gradingIdentity(saved.details);
      try{const existing=await workflow.service.read(staff,cardId);await current(staff,existing);return {card:existing};}
      catch(error){if(error?.code!=='MANUAL_CARD_NOT_FOUND')throw error;}
      const packet=await limited(()=>build(staff,cardId,saved.details,pair));
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
  });
}
