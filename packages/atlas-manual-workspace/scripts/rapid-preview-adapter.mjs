/** Loopback demo only: synthetic photos, actual preparation/review reducers and CPU measurement.
 * Nothing here authenticates staff, writes production data or certifies a report. */
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {verifyAndDecodePhoto,describeDecodedFrame} from '../../atlas-photo-runtime/src/index.mjs';
import {prepareGeometry} from '../../atlas-preparation-runtime/src/index.mjs';
import {measureDefectWorkspaceEdit} from '../../atlas-measurement-runtime/src/index.mjs';
import {createGeometryWorkspace,applyGeometryEdit,applyPreparedFrame,geometryBase,preparationBase,
  markPrintedBorderAbsent,confirmBothGeometry} from '../src/geometry-actions.mjs';
import {createDefectWorkspace,adoptDefectProposals,defectBase,invalidateDefectFindingReviews,
  applyDefectMeasurement,markDefectFindingReviewed,markDefectSideInspected,confirmDefectFindings,
  previewDefectReport} from '../src/defect-actions.mjs';
import {beginReprojectDefectFrame} from '../src/geometry-reprojection.mjs';
import {focusedFixture,printed} from '../test/focused-geometry-fixture.mjs';
import {measurements} from '../test/defect-fixtures.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const SIDES=['FRONT','BACK'];
const limits={maxInputBytes:12_000_000,maxPixels:5_000_000,maxOutputBytes:20_000_000,timeoutMs:30_000};
const measurementLimits={maxInputBytes:8_000_000,maxOutputBytes:16_000_000,maxFindings:200,timeoutMs:30_000};
const sharp=createRequire(new URL('../../../frontend/atlas-app/package.json',import.meta.url))('sharp');
const frameFromGeometry=(geometry,side)=>{
  const slot=geometry.sides[side],frame=slot.prepared.frame;
  return {imageVersion:slot.image.version,preparationVersion:frame.version,frameId:frame.id,
    originalSha256:slot.image.originalSha256,inspectionImageSha256:frame.inspection.sha256,
    rectifiedImageSha256:frame.rectified.sha256};
};

export async function createRapidPreviewAdapter({pythonExecutable,beforePrepare=async()=>{}}={}) {
  if(!pythonExecutable?.startsWith('/'))throw Error('ATLAS_FIXTURE_PYTHON must name an absolute local CPU Python executable');
  const cardId='focused-synthetic',assets=new Map(),sources={},previousGeometry={},actions=[];
  let geometry,defects,revision=1,queue=Promise.resolve();
  const identity={playerName:'Synthetic reviewer card',year:'2026',manufacturer:'Local fixture',productSet:'Not production'};
  const retain=(bytes,mime)=>{
    const hash=sha(bytes);assets.set(hash,{bytes:Buffer.from(bytes),mime});return hash;
  };
  const sourcePng=await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="2400"><rect width="100%" height="100%" fill="#171d23"/><rect x="180" y="250" width="1269" height="1777" fill="#d6bd79"/><rect x="240" y="340" width="1129" height="1607" fill="#315973"/><text x="330" y="1050" fill="white" font-size="85">Synthetic card</text></svg>')).removeAlpha().png().toBuffer();
  for(const side of SIDES){
    const key=`synthetic/${side}.png`,decoded=await verifyAndDecodePhoto({bytes:sourcePng,
      limits:{...limits,maxRasterBytes:40_000_000},
      uploadPlan:{schemaVersion:1,uploadId:`demo-${side}`,binding:{cardId,pairId:'demo-pair',side,version:1},
        object:{key,versionId:null},expected:{sha256:sha(sourcePng),byteCount:sourcePng.length}},observedObject:{key,versionId:null}});
    sources[side]={original:decoded.original,decodePlan:decoded.decodePlan,bytes:decoded.png,
      frame:describeDecodedFrame(decoded,{id:`${side}-source`,object:{key:`working/${side}.png`,versionId:null}})};
    retain(decoded.png,'image/png');
  }
  geometry=createGeometryWorkspace({cardId,profile:'SPORTS',sides:Object.fromEntries(SIDES.map(side=>{
    const source=sources[side],raster=source.frame.raster;
    return [side,{matColor:'BLACK',cornerShape:'SQUARE',image:{version:1,originalSha256:source.original.content.sha256,
      frameId:source.frame.id,frameSha256:raster.content.sha256,...raster.dimensions,coordinateSpace:'ORIENTED_DECODED'}}];
  }))});
  const prepare=async(current,side)=>{
    const result=await prepareGeometry({workspace:current,side,source:sources[side],limits,pythonExecutable});
    const next=applyPreparedFrame(current,{side,base:preparationBase(current,side),frame:result.frame}).state;
    return {geometry:next,result};
  };
  const retainPrepared=result=>{
    for(const name of ['rectified','inspection'])retain(result.outputs[name].bytes,result.outputs[name].mime);
  };
  const initial=focusedFixture().workspace;
  for(const side of SIDES){
    geometry=applyGeometryEdit(geometry,{side,kind:'PHYSICAL',base:geometryBase(geometry,side,'PHYSICAL'),
      quad:initial.sides[side].physical.quad,actor:'HUMAN'}).state;
    const prepared=await prepare(geometry,side);geometry=prepared.geometry;retainPrepared(prepared.result);
    geometry=applyGeometryEdit(geometry,{side,kind:'PRINTED',base:geometryBase(geometry,side,'PRINTED'),quad:printed,actor:'HUMAN'}).state;
  }
  defects=createDefectWorkspace({cardId,profile:'SPORTS',sides:Object.fromEntries(SIDES.map(side=>[side,{
    frame:frameFromGeometry(geometry,side),cornerShape:'SQUARE'}]))});
  for(const side of SIDES)defects=adoptDefectProposals(defects,{side,base:defectBase(defects,side),findings:[structuredClone(measurements[side])],
    source:{method:'DETECTOR',version:'synthetic-fixture-only',id:`fixture-${side}`}}).state;

  const descriptor=(hash,width,height)=>{
    const asset=assets.get(hash);if(!asset)throw Error('Verified demo image missing');
    return {url:`/images/${hash}`,sha256:hash,byteCount:asset.bytes.length,width,height};
  };
  const view=()=>structuredClone({card:{id:cardId,revision,contentHash:`fixture-${revision}`},geometry,defects,
    images:Object.fromEntries(SIDES.map(side=>{const slot=geometry.sides[side],prepared=slot.prepared?.frame;
      return [side,{original:descriptor(slot.image.frameSha256,slot.image.width,slot.image.height),
        ...(prepared?{inspection:descriptor(prepared.inspection.sha256,1350,1858),rectified:descriptor(prepared.rectified.sha256,1270,1778)}:{})}];})),
    identity,astra:{enabled:false},finalReview:{report:{findings:SIDES.flatMap(side=>defects.sides[side].findings)}},
    provisional:{state:'READY',report:{findings:SIDES.flatMap(side=>defects.sides[side].findings)}}});
  const apply=async action=>{
    if(action.type==='GEOMETRY_EDIT'){
      const {side,kind}=action.edit;
      const next=applyGeometryEdit(geometry,{...action.edit,actor:'HUMAN'}).state;
      const nextDefects=invalidateDefectFindingReviews(defects,side);
      if(kind==='PHYSICAL'&&geometry.sides[side].prepared)previousGeometry[side]??=geometry;
      geometry=next;defects=nextDefects;
    }else if(action.type==='PREPARE_SIDE'){
      const side=action.side;
      await beforePrepare({geometry:structuredClone(geometry),side});
      const candidate=await prepare(geometry,side);
      if(!previousGeometry[side])throw Error('Prior demo geometry required for preparation');
      const pending=beginReprojectDefectFrame({workspace:defects,side,previousGeometry:previousGeometry[side],geometry:candidate.geometry});
      const measured=await measureDefectWorkspaceEdit({workspace:pending,side,pythonExecutable,limits:measurementLimits});
      const nextDefects=applyDefectMeasurement(pending,measured).state;
      // Keep old evidence/images if preparation, reprojection or measurement fails.
      retainPrepared(candidate.result);geometry=candidate.geometry;defects=nextDefects;delete previousGeometry[side];
    }else if(action.type==='MARK_PRINTED_ABSENT'){
      geometry=markPrintedBorderAbsent(geometry,{side:action.side,base:action.base,actor:'HUMAN'}).state;
      defects=invalidateDefectFindingReviews(defects,action.side);
    }else {
      const request={...action,actor:'HUMAN'};delete request.type;
      if(action.type==='CONFIRM_GEOMETRY')geometry=confirmBothGeometry(geometry,request).state;
      else if(action.type==='REVIEW_FINDING')defects=markDefectFindingReviewed(defects,{...request,reviewerId:'synthetic',reviewedAt:new Date().toISOString()}).state;
      else if(action.type==='INSPECT_SIDE')defects=markDefectSideInspected(defects,request).state;
      else if(action.type==='CONFIRM_FINDINGS')defects=confirmDefectFindings(defects,request).state;
      else throw Error(`Unsupported synthetic action ${action.type}`);
    }
    revision++;actions.push(structuredClone(action));return view();
  };
  return {
    view,
    asset:hash=>assets.get(hash),
    actions:()=>structuredClone(actions),
    execute:action=>{const owned=structuredClone(action),pending=queue.then(()=>apply(owned));queue=pending.catch(()=>{});return pending;},
    preview:()=>({report:previewDefectReport(defects,{identity,centeringQuads:Object.fromEntries(SIDES.map(side=>[side,geometry.sides[side].printed?.quad??null])),draftRevision:revision}),
      reportHash:sha(JSON.stringify({geometry,defects,revision})),sourceRevision:revision,sourceHash:`fixture-${revision}`,canCertify:false}),
  };
}
