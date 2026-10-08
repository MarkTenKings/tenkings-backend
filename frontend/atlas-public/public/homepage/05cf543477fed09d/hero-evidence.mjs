/** ATLAS approved-report evidence adapter. Rendering never changes saved grading data.
 * Coordinates: RLE cells use [0,width]×[0,height] edges; saved contour centers
 * use x*(width-1), y*(height-1). Presentation registration is approximate.
 */
export const HERO_EVIDENCE_SCHEMA = 'atlas-hero-evidence-v1';
export const SIDES = Object.freeze(['FRONT','BACK']);
const clone = value => JSON.parse(JSON.stringify(value));
const requireThat = (condition,message) => { if(!condition) throw new Error(`ATLAS evidence: ${message}`); };
const finite = value => typeof value === 'number' && Number.isFinite(value);
const hashPattern = /^[a-f0-9]{64}$/;

export function transformPoint(matrix,point) {
 const [x,y]=Array.isArray(point)?point:[point.x,point.y];
 const q=matrix.map(row=>row[0]*x+row[1]*y+row[2]);
 requireThat(q.every(finite)&&Math.abs(q[2])>1e-12,'invalid projective point');
 return [q[0]/q[2],q[1]/q[2]];
}
export const canonicalToSource=(side,point)=>transformPoint(side.transforms.canonicalToSource,point);
export const canonicalToCleanUV=(side,point)=>transformPoint(side.transforms.canonicalToCleanUV,point);
export const cleanUVToSource=(side,point)=>canonicalToSource(side,transformPoint(side.transforms.cleanUVToCanonical,point));
export const findingsForSide=(manifest,side)=>manifest.findings.filter(finding=>finding.side===side);

export function traceHashPreimage(trace) {
 return `${trace.format}\n${trace.width}\n${trace.height}\n${trace.origin}\n${trace.order}\n0\n${trace.runs.join(',')}\n`;
}
export function validateTrace(trace) {
 requireThat(trace?.format==='TK_SPEEDSTER_TRACE_RLE_V1' && trace.origin==='TOP_LEFT' && trace.order==='ROW_MAJOR_Y_X','unsupported trace encoding');
 requireThat(trace.width===1270&&trace.height===1778,'unsupported canonical trace dimensions');
 requireThat(Array.isArray(trace.runs)&&trace.runs.length>1&&trace.runs.every((n,i)=>Number.isSafeInteger(n)&&n>=(i?1:0)),'invalid trace runs');
 requireThat(trace.runs.reduce((a,b)=>a+b,0)===trace.width*trace.height,'trace size mismatch');
 requireThat(hashPattern.test(trace.sha256),'missing trace binding');
 return trace;
}
export function* traceSpans(trace) {
 validateTrace(trace);let cursor=0;
 for(let i=0;i<trace.runs.length;i++){
  let n=trace.runs[i];if(!(i%2)){cursor+=n;continue;}
  while(n){const y=Math.floor(cursor/trace.width),x=cursor%trace.width,width=Math.min(n,trace.width-x);yield {x,y,width};cursor+=width;n-=width;}
 }
}
export function traceGeometry(trace) {
 let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity,pixels=0,sx=0,sy=0;
 for(const {x,y,width} of traceSpans(trace)){
  left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+width);bottom=Math.max(bottom,y+1);
  pixels+=width;sx+=width*(x+width/2);sy+=width*(y+.5);
 }
 requireThat(pixels>0,'empty saved trace');
 return {bounds:[left,top,right,bottom],centroid:[sx/pixels,sy/pixels],pixelCount:pixels};
}
/** Exact run path, including disconnected islands and holes. No contour fitting. */
export function traceSvgPath(findingOrTrace,{space='canonical',side=null}={}) {
 const trace=findingOrTrace.trace||findingOrTrace.finalTrace||findingOrTrace;
 return [...traceSpans(trace)].map(({x,y,width})=>{
  if(space==='canonical') return `M${x} ${y}h${width}v1h-${width}Z`;
  requireThat(side,'a side transform is required for source paths');
  const h=side.transforms.canonicalToSource;
  if(h[0][0]===1&&h[0][1]===0&&h[1][0]===0&&h[1][1]===1&&h[2][0]===0&&h[2][1]===0&&h[2][2]===1)
   return `M${x+h[0][2]} ${y+h[1][2]}h${width}v1h-${width}Z`;
  const points=[[x,y],[x+width,y],[x+width,y+1],[x,y+1]].map(p=>canonicalToSource(side,p));
  return points.map((p,i)=>`${i?'L':'M'}${p[0]} ${p[1]}`).join('')+'Z';
 }).join('');
}
export function contourSourcePoints(side,contour,card) {
 return contour.map(p=>canonicalToSource(side,[p.x*(card.canonicalWidth-1),p.y*(card.canonicalHeight-1)]));
}
function projectedBounds(bounds,matrix){
 const [x,y,r,b]=bounds,points=[[x,y],[r,y],[r,b],[x,b]].map(p=>transformPoint(matrix,p));
 return [Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))];
}
/** Calibrated maximum straight span of occupied pixel edges, not scratch depth. */
export function markedSpan(trace,card) {
 const points=[...traceSpans(trace)].flatMap(({x,y,width})=>[[x,y],[x+width,y],[x,y+1],[x+width,y+1]]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
 const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
 const half=arr=>{const h=[];for(const p of arr){while(h.length>1&&cross(h.at(-2),h.at(-1),p)<=0)h.pop();h.push(p);}return h;};
 const hull=[...half(points).slice(0,-1),...half([...points].reverse()).slice(0,-1)];
 if(!card.widthMm||!card.heightMm)return null;
 let best=-1,start,end;
 for(let i=0;i<hull.length;i++)for(let j=i+1;j<hull.length;j++){
  const a=hull[i],b=hull[j],d=((a[0]-b[0])*card.widthMm/trace.width)**2+((a[1]-b[1])*card.heightMm/trace.height)**2;
  if(d>best){best=d;start=a;end=b;}
 }
 return best<0?null:{mm:Math.sqrt(best),start,end,coordinateSpace:'canonical-pixel-edges'};
}
/** Pure adapter for normal approved output. Asset bindings come from the export
 * pipeline, never from guessed paths. Unknown formats retain 2D capability. */
export function adaptApprovedReport(record,bindings) {
 const packet=record.packet||record,report=packet.report;
 requireThat(packet.version==='atlas-public-manual-report-v2'&&report,'unsupported approved packet');
 requireThat(packet.approvedAt&&hashPattern.test(packet.reportHash||record.publicHash),'missing approval binding');
 requireThat(bindings.reportHash===(packet.reportHash||record.publicHash)&&bindings.approvalVersion===packet.approvalVersion,'asset/report version mismatch');
 requireThat(report.version==='atlas-manual-draft-report-v2'&&report.finalGradePolicy==='atlas-final-half-point-v1','unsupported awarded-grade policy');
 const unresolved=report.calculationState==='GEOMETRY_UNRESOLVED';
 requireThat(unresolved||finite(report.finalGrade),'missing awarded grade');
 const knownProfile=bindings.card?.profile===report.cardProfile;
 const card={profile:report.cardProfile,canonicalWidth:1270,canonicalHeight:1778,widthMm:knownProfile?bindings.card.widthMm:null,heightMm:knownProfile?bindings.card.heightMm:null,thicknessMm:null};
 const sides={};
 for(const side of SIDES){
  const binding=bindings.sides[side],image=packet.images?.[side],inspection=report.inspection?.[side.toLowerCase()];
  requireThat(binding&&image&&binding.original?.sha256===image.sha256,'source image hash mismatch');
  requireThat(inspection?.inspected===true&&inspection.imageSha256===image.sha256,'unverified inspection image');
  requireThat(binding.original.width===image.width&&binding.original.height===image.height,'source image dimension mismatch');
  const transforms=clone(binding.transforms),g=packet.geometry?.[side];
  const toSource=quad=>quad?.map(p=>transformPoint(transforms.canonicalToSource,[p.x*card.canonicalWidth,p.y*card.canonicalHeight]))??null;
  const centering=report.grade?.[side.toLowerCase()]?.centering;
  sides[side]={...clone(binding),geometry:{physicalQuadSource:toSource(g?.physicalQuad),printedQuadSource:toSource(g?.printedQuad),physicalQuadCanonical:g?.physicalQuad?.map(p=>[p.x*1270,p.y*1778])??null,printedQuadCanonical:g?.printedQuad?.map(p=>[p.x*1270,p.y*1778])??null},centering:centering?{leftRight:clone(centering.leftRightBalance),topBottom:clone(centering.topBottomBalance),score:centering.score}:null};
 }
 const findings=[];let excludedCount=0;
 for(const original of report.findings||[]){
  if(original.reviewResult==='REMOVED'||original.geometryExclusion){excludedCount++;continue;}
  requireThat(original.reviewResult==='ACCEPTED','unapproved finding');
  const trace=clone(original.finalTrace||original.detectorMask);validateTrace(trace);
  const geometry=traceGeometry(trace),side=sides[original.side];requireThat(side,'unknown finding side');
  const regions=clone(original.measurementRegions||[]);
  requireThat(regions.length&&regions.every(r=>r.zone&&r.measurement&&Array.isArray(r.canonicalContour)),'missing saved measurement regions');
  const finding={id:original.id,side:original.side,defectType:original.defectType,reviewResult:original.reviewResult,categories:[...new Set(regions.map(r=>r.zone.toLowerCase()))],trace,boundsCanonical:geometry.bounds,boundsSource:projectedBounds(geometry.bounds,side.transforms.canonicalToSource),centroidCanonical:geometry.centroid,centroidSource:canonicalToSource(side,geometry.centroid),centroidCleanUV:side.transforms.canonicalToCleanUV?canonicalToCleanUV(side,geometry.centroid):null,pixelCount:geometry.pixelCount,regions,markedSpan:markedSpan(trace,card)};
  finding.sourceSvgPath=traceSvgPath(finding,{space:'source',side});
  finding.canonicalSvgPath=traceSvgPath(finding);
  const [x,y,right,bottom]=finding.boundsCanonical,w=Math.min(1270,Math.max(96,right-x)*1.5),h=Math.min(1778,Math.max(96,bottom-y)*1.5);
  const crop=[Math.max(0,Math.min(1270-w,(x+right-w)/2)),Math.max(0,Math.min(1778-h,(y+bottom-h)/2))];
  const cropBounds=projectedBounds([crop[0],crop[1],crop[0]+w,crop[1]+h],side.transforms.canonicalToSource);
  finding.inspectionCrop={x:cropBounds[0],y:cropBounds[1],width:cropBounds[2]-cropBounds[0],height:cropBounds[3]-cropBounds[1]};
  findings.push(finding);
 }
 for(const side of SIDES){
  const traceHashes=findings.filter(f=>f.side===side).map(f=>f.trace.sha256).sort();
  for(const kind of ['mask','fingerprint']){
   const supplied=sides[side][kind]?.sourceTraceHashes;
   if(!Array.isArray(supplied)||JSON.stringify([...supplied].sort())!==JSON.stringify(traceHashes))sides[side][kind]=null;
  }
 }
 const identity=clone(report.identity),archived=bindings.status==='ARCHIVED_APPROVED_SAMPLE';
 const result={schema:HERO_EVIDENCE_SCHEMA,report:{displayName:identity.playerName||identity.cardName||'Graded card',subtitle:[identity.year,identity.productSet,identity.cardNumber].filter(Boolean).join(' · '),identity,finalGrade:unresolved?null:report.finalGrade,subgrades:clone(report.grade?.subgrades||{}),reportNumber:packet.reportNumber,approvedAt:packet.approvedAt,approvalVersion:packet.approvalVersion,reportHash:packet.reportHash||record.publicHash,status:bindings.status||'APPROVED',liveUrl:archived?null:bindings.liveUrl||null,findingCount:findings.length,excludedFindingCount:excludedCount},card,sides,findings,selectedMacro:clone(bindings.selectedMacro||null),poster:clone(bindings.poster||null),spatialReady:!unresolved&&Boolean(card.widthMm&&card.heightMm)&&SIDES.every(side=>Boolean(sides[side].presentation&&sides[side].mask&&sides[side].transforms.canonicalToCleanUV&&sides[side].geometry.physicalQuadSource)),coordinateConventions:{origin:'TOP_LEFT',bounds:'[left,top,right,bottom], right/bottom exclusive',rle:'integer pixel cells with centers x+.5,y+.5',contour:'saved normalized center coordinates ×[1269,1777]',geometry:'approved normalized geometry ×[1270,1778]',presentation:'approximate registration; source photo plus exact mask is authoritative',backOrientation:'upright texture; mirror X once only when constructing back face'}};
 return validateHeroEvidence(result);
}
export function validateHeroEvidence(manifest) {
 requireThat(manifest.schema===HERO_EVIDENCE_SCHEMA,'unsupported hero schema');
 requireThat(manifest.report?.status!=='ARCHIVED_APPROVED_SAMPLE'||manifest.report.liveUrl===null,'archived sample cannot have live report link');
 const ids=new Set();
 for(const finding of manifest.findings){requireThat(!ids.has(finding.id),'duplicate finding ID');ids.add(finding.id);validateTrace(finding.trace);requireThat(traceGeometry(finding.trace).pixelCount===finding.pixelCount,'trace pixel count mismatch');}
 requireThat(manifest.report.findingCount===manifest.findings.length,'finding count mismatch');
 for(const side of SIDES){
  const s=manifest.sides[side];requireThat(s&&hashPattern.test(s.original.sha256),'missing original binding');
  for(const name of ['canonicalToSource','sourceToCanonical'])requireThat(s.transforms[name]?.length===3&&s.transforms[name].every(row=>row.length===3&&row.every(finite)),'invalid source transform');
  for(const p of [[0,0],[1269,1777],[635,889]]){
   const q=transformPoint(s.transforms.sourceToCanonical,canonicalToSource(s,p));requireThat(Math.hypot(q[0]-p[0],q[1]-p[1])<1e-6,'source transform inverse mismatch');
  }
  if(s.transforms.canonicalToCleanUV&&s.transforms.cleanUVToCanonical)for(const p of [[0,0],[1269,0],[1269,1777],[0,1777],[635,889]]){
   const q=transformPoint(s.transforms.cleanUVToCanonical,transformPoint(s.transforms.canonicalToCleanUV,p));requireThat(Math.hypot(q[0]-p[0],q[1]-p[1])<1e-6,'presentation transform inverse mismatch');
  }
 }
 return manifest;
}
export async function sha256Hex(bytes) {
 const digest=await globalThis.crypto.subtle.digest('SHA-256',bytes);
 return [...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
}
export async function loadHeroEvidence(url='/homepage/05cf543477fed09d/hero-assets/manifest.json',{signal,fetcher=globalThis.fetch}={}) {
 const response=await fetcher(url,{signal});requireThat(response.ok,'manifest fetch failed');
 const manifest=validateHeroEvidence(await response.json());
 await Promise.all(manifest.findings.map(async finding=>requireThat(await sha256Hex(new TextEncoder().encode(traceHashPreimage(finding.trace)))===finding.trace.sha256,'trace hash mismatch')));
 return manifest;
}
/** Fetch/decode separately: callers own object URLs and GPU cleanup. */
export async function fetchVerifiedAsset(asset,{signal,fetcher=globalThis.fetch}={}) {
 const response=await fetcher(asset.src,{signal});requireThat(response.ok,'asset fetch failed');const bytes=await response.arrayBuffer();
 requireThat(!asset.bytes||bytes.byteLength===asset.bytes,'asset byte count mismatch');
 requireThat(await sha256Hex(bytes)===asset.sha256,'asset hash mismatch');
 return new Blob([bytes],{type:asset.contentType||response.headers.get('content-type')||'application/octet-stream'});
}
