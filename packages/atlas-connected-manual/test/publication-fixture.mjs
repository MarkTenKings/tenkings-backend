import { randomUUID } from 'node:crypto';
import { canonical, digest } from '@atlas/manual-service/contract';
import { createManualArtifactStore } from '@atlas/manual-service/artifacts';
import { createGeometryWorkspace, applyGeometryEdit, applyPreparedFrame, geometryBase, preparationBase, confirmBothGeometry } from '@atlas/manual-workspace/geometry-actions';
import { defectBase, markDefectSideInspected, confirmDefectFindings, previewDefectReport } from '@atlas/manual-workspace/defect-actions';
import { workspace } from '../../atlas-manual-workspace/test/defect-fixtures.mjs';
import { createManualPublication } from '../src/publication.mjs';
import { publicationStatus } from '../src/publication-repository.mjs';
export const sides = ['FRONT','BACK'];
export async function publicationFixture() {
  const cardId=randomUUID(), actionId=randomUUID(), actorId=randomUUID(), records=new Map();
  const bytes=Object.fromEntries(sides.map(side=>[side,Buffer.from(`synthetic inspection ${side}`)]));
  let failRead=false, corruptBytes=false, loseWriteReply=false, completeCalls=0;
  const artifacts=createManualArtifactStore({transport:{async putIfAbsent({key,bytes,lineageSha256,contentType}) {
    if(records.has(key)) throw new Error('exists'); records.set(key,{bytes:Buffer.from(bytes),lineageSha256,contentType});
    if(loseWriteReply) throw new Error('lost storage reply');
  },async read({key}) { if(!records.has(key)) throw new Error('missing'); return records.get(key); }}});
  const save=async(kind,value)=>{const sourceHash=digest(JSON.stringify(value));return {ref:await artifacts.write(value,{cardId,kind,sourceHash}),sourceHash};};
  const printed=[{x:.04,y:.03},{x:.96,y:.03},{x:.96,y:.97},{x:.04,y:.97}];
  let geometry=createGeometryWorkspace({cardId,profile:'SPORTS',sides:Object.fromEntries(sides.map((side,i)=>[side,{
    image:{version:1,originalSha256:String(i+1).repeat(64),frameId:`working-${side}`,frameSha256:String(i+3).repeat(64),width:1600,height:2400,coordinateSpace:'ORIENTED_DECODED'},cornerShape:'SQUARE',matColor:'BLACK'}]))});
  const prepared={}, photos={};
  for(const side of sides){
    geometry=applyGeometryEdit(geometry,{side,kind:'PHYSICAL',quad:[{x:.125,y:.1},{x:.875,y:.1},{x:.875,y:.9},{x:.125,y:.9}],actor:'HUMAN',proposal:null,base:geometryBase(geometry,side,'PHYSICAL')}).state;
    const sx=1269/1200,sy=1777/1920,frame={id:`prepared-${side}`,version:1,rectified:{sha256:'f'.repeat(64),width:1270,height:1778},inspection:{sha256:digest(bytes[side]),width:1350,height:1858,cardBounds:{x:40,y:40,width:1270,height:1778}},sourceToRectified:[sx,0,-200*sx,0,sy,-240*sy,0,0,1]};
    geometry=applyPreparedFrame(geometry,{side,base:preparationBase(geometry,side),frame}).state;
    geometry=applyGeometryEdit(geometry,{side,kind:'PRINTED',quad:printed,actor:'HUMAN',proposal:null,base:geometryBase(geometry,side,'PRINTED')}).state;
    const descriptor={purpose:'inspection',raster:{content:{mime:'image/webp',sha256:digest(bytes[side]),byteCount:bytes[side].length},dimensions:{width:1350,height:1858},object:{key:`private/${side}`}}};
    prepared[side]=await save('PREPARED_IMAGES',{frameId:frame.id,images:{inspection:descriptor}});
    photos[side]={original:{content:{sha256:geometry.sides[side].image.originalSha256}},workingFrame:{id:`working-${side}`,raster:{content:{sha256:geometry.sides[side].image.frameSha256}}},decodePlan:{private:'not public'}};
  }
  geometry=confirmBothGeometry(geometry,{actor:'HUMAN',reviewed:true,base:Object.fromEntries(sides.map(side=>[side,geometryBase(geometry,side,'REVIEW')]))}).state;
  let defects=structuredClone(workspace());
  for(const side of sides) defects.sides[side].frame.inspectionImageSha256=digest(bytes[side]);
  for(const side of sides){defects=markDefectSideInspected(defects,{side,base:defectBase(defects,side),actor:'HUMAN',inspected:true}).state;}
  defects=confirmDefectFindings(defects,{base:Object.fromEntries(sides.map(side=>[side,defectBase(defects,side)])),actor:'HUMAN',reviewed:true}).state;
  const full=previewDefectReport(defects,{identity:{playerName:'Synthetic report',year:'2026',manufacturer:'Fixture',productSet:'Local only'},centeringQuads:{FRONT:printed,BACK:printed},draftRevision:10});
  const report=await save('REPORT',full), draft={version:'test-approved-source-v1',geometry:await save('GEOMETRY',geometry),source:{prepared,uploads:{FRONT:{side:'FRONT'},BACK:{side:'BACK'}}}};
  const approval={version:'atlas-manual-report-snapshot-v2',report,identity:full.identity,grade:full.grade,finalGrade:full.finalGrade,finalGradePolicy:full.finalGradePolicy,findingCounts:full.findingCounts,ruleVersion:full.ruleVersion};
  const reportText=canonical(approval),sourceHash=digest(canonical(draft));
  const row={card_id:cardId,action_id:actionId,actor_id:actorId,source_revision:10,source_hash:sourceHash,report_hash:digest(reportText),report:reportText,approved_at:'2026-09-22T12:00:00.000Z',public_token:'ar_'+ 'A'.repeat(24),report_number:'ATLAS-012345ABCDEF',version:1,mode:'LOCAL_FIXTURE',state:'PENDING'};
  row.result=canonical({card:{cardId,revision:11,contentHash:sourceHash,draft},receipt:{actionId,actorId,approval:{reportHash:row.report_hash,sourceHash,sourceRevision:10}}});
  const storage={async readDerivative({descriptor}){if(failRead)throw new Error('private storage unavailable'); const side=sides.find(s=>digest(bytes[s])===descriptor.raster.content.sha256);return {bytes:corruptBytes?Buffer.from('changed bytes'):bytes[side]};}};
  const repository={async load(){return structuredClone(row);},async status(){return publicationStatus(row);},async complete(staff,before,manifest){completeCalls++;Object.assign(row,{state:'PUBLISHED',manifest:canonical(manifest),manifest_hash:digest(canonical(manifest)),public_hash:manifest.publicHash});return publicationStatus(row);}};
  const publication=createManualPublication({repository,artifacts,storage,readSource:async(staff,id,upload)=>({photo:photos[upload.side]})});
  return {cardId,actionId,actorId,row,draft,approval,full,geometry,photos,bytes,artifacts,records,storage,repository,publication,save,get completeCalls(){return completeCalls;},failRead(value=true){failRead=value;},corruptBytes(value=true){corruptBytes=value;},loseWriteReply(){loseWriteReply=true;}};
}
