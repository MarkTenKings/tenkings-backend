// Synthetic only: real parser/HTTP/auth-cookie boundary and actual WebP bytes;
// owner/publication readers are in-memory capabilities, not SQL/storage proof.
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {CustomerAuth} from '../lib/server/auth.mjs';
import {createCollectionDisplayService} from '../lib/server/collection-display-service.mjs';
import {createCollectionDisplayHandler} from '../lib/server/collection-display-http.mjs';
import {createCollectionPreviewFixture} from './collection-preview-fixture.mjs';
const require=createRequire(new URL('../../../packages/atlas-connected-manual/package.json',import.meta.url));
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
let photo;
export async function createCollectionDisplayFixture() {
  photo??=await require('sharp')({create:{width:1350,height:1858,channels:3,background:'#e8efea'}}).webp().toBuffer();
  const original=createCollectionPreviewFixture(),card=structuredClone(original.snapshot.cards[0]);
  const side=()=>({centering:{score:9,leftRightBalance:[50,50],topBottomBalance:[50,50]},corners:{score:9,weightedDamagePercent:0},edges:{score:9,weightedDamagePercent:0},surface:{score:9,weightedDamagePercent:0}});
  const image={sha256:sha(photo),byteCount:photo.length,width:1350,height:1858,contentType:'image/webp'};
  const quad=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];
  const packet={version:'atlas-public-manual-report-v2',publicToken:card.approvedCard.report.publicToken,reportNumber:card.approvedCard.certificateNumber,
    approvalVersion:1,approvedAt:'2026-10-22T08:00:00.000Z',mode:'LOCAL_FIXTURE',reportHash:'c'.repeat(64),
    report:{version:'atlas-manual-draft-report-v2',ruleVersion:'SYNTHETIC_SAVED_RULE',cardProfile:'SPORTS',
      identity:{playerName:'Synthetic collection card',year:'2026',manufacturer:'Fixture',productSet:'Approved reference',parallel:null,insert:null,cardNumber:'7'},draftRevision:3,
      inspection:{method:'HUMAN',front:{inspected:true,imageSha256:image.sha256,findingRevision:1},back:{inspected:true,imageSha256:image.sha256,findingRevision:1}},
      grade:{front:side(),back:side(),subgrades:{centering:9,corners:9,edges:9,surface:9},overall:{displayGrade:9,rawGrade:9}},
      finalGrade:9,finalGradePolicy:'atlas-final-whole-point-v1',findings:[],findingCounts:{total:0,included:0,removed:0,unreviewed:0}},
    images:{FRONT:{...image},BACK:{...image}},geometry:{FRONT:{physicalQuad:quad,printedQuad:quad},BACK:{physicalQuad:quad,printedQuad:quad}}};
  card.approvedCard.report.publicHash=sha(JSON.stringify(packet));original.snapshot.cards=[card];
  const f={...original,card,packet,bytes:Buffer.from(photo),reads:[],requests:[],ownerHook:null,reportHook:null,imageHook:null};
  f.refreshHash=()=>{card.approvedCard.report.publicHash=sha(JSON.stringify(f.packet));};
  const token=Buffer.alloc(32,7).toString('base64url');f.cookie=`browser=${token}; session=${token}`;
  f.ownershipRead={async read(cookie,action,input){f.reads.push({kind:'owner',action,input});if(cookie!==f.cookie)throw {code:'SIGN_IN_REQUIRED',status:401};await f.ownerHook?.();return structuredClone(f.card);}};
  f.approvedReader={async readReport(input){f.reads.push({kind:'report',input});await f.reportHook?.();return {packet:structuredClone(f.packet),publicHash:f.card.approvedCard.report.publicHash};},
    async readImage(input){f.reads.push({kind:'image',input});await f.imageHook?.();return {bytes:f.bytes,contentType:'image/webp'};}};
  f.service=createCollectionDisplayService({ownershipRead:f.ownershipRead,approvedReader:f.approvedReader,mode:'LOCAL_FIXTURE'});
  const config={mode:'LOCAL_FIXTURE',origin:'https://fixture.invalid',deploymentId:'fixture',releaseSha:'a'.repeat(40),configHash:'b'.repeat(64),cookies:{browser:'browser',session:'session'}};
  config.binding=Object.fromEntries(['mode','origin','deploymentId','releaseSha','configHash'].map(k=>[k,config[k]]));
  f.state={config,auth:new CustomerAuth({config,database:{call(){throw Error('No generic database');}}}),assertRequest(req){if(req.headers['x-fixture-ingress']!=='accepted')throw {status:403};}};
  f.handler=createCollectionDisplayHandler({customerState:f.state,displayService:f.service});
  f.invoke=async(req)=>{const res={headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=String(v);},status(n){this.code=n;return this;},json(v){this.value=v;this.headers['content-type']='application/json';return this;},end(v){this.bytes=v;return this;}};await f.handler(req,res);return res;};
  f.fetch=async(path,options={})=>{f.requests.push({path,options});const res=await f.invoke({method:options.method??'GET',url:path.replace(/^\/account/,''),body:'',headers:{cookie:f.cookie,'sec-fetch-site':'same-origin','x-fixture-ingress':'accepted',...options.headers}});
    return new Response(res.bytes??JSON.stringify(res.value),{status:res.code,headers:res.headers});};
  return f;
}

// Root's browser preview can serialize this data once, then bundle only the
// actual JSX + browser reader with an in-memory GET transport. No server module
// or decoder belongs in that browser bundle. The photo is synthetic Sharp
// output at the real packet dimensions; it is not a customer reference copy.
export async function createCollectionDisplayPreviewData() {
  const f=await createCollectionDisplayFixture();
  return {accountId:f.accountId,snapshot:f.snapshot,display:await f.service.readDisplay(f.cookie,f.card.cardId),photoBase64:f.bytes.toString('base64')};
}
