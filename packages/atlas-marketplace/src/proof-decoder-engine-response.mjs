import {requireValue} from './contract.mjs';
import {decoderContractData,decoderFreeze} from './proof-decoder-profile.mjs';
import {proofDecoderEngineContext,proofDecoderEngineLabels} from './proof-decoder-engine-request.mjs';
import {ENGINE_JSON_BYTES,engineBytesHash,engineDataOptions,parseProofDecoderEngineJSON} from './proof-decoder-engine-json.mjs';

const check=value=>requireValue(value,'DECODER_ENGINE_RESPONSE_INVALID');
const object=value=>value&&Object.getPrototypeOf(value)===Object.prototype;
const id=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const imageId=value=>typeof value==='string'&&/^sha256:[a-f0-9]{64}$/.test(value);
const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const timestamp=value=>typeof value==='string'&&value.length<=40&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(Date.parse(value)).toISOString().slice(0,19)===value.slice(0,19);

function responseHeaders(input) {
  const value=decoderContractData(input);check(object(value)&&Object.keys(value).length<=32);
  const result={};let bytes=0;
  for(const [key,item] of Object.entries(value)){
    const lower=key.toLowerCase();check(/^[a-z0-9-]{1,64}$/.test(lower)&&!Object.hasOwn(result,lower)&&typeof item==='string'&&!/[\r\n\0]/.test(item));
    bytes+=Buffer.byteLength(key)+Buffer.byteLength(item);check(bytes<=8192);result[lower]=item;
  }
  return result;
}
function isJSON(headers){return typeof headers['content-type']==='string'&&/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(headers['content-type']);}

// The caller must feed any HTTP parser upgradeHead separately to the stream
// decoder exactly once. A body here would otherwise silently discard bytes.
export function assertProofDecoderEngineUpgrade({statusCode,headers,body}) {
  const values=responseHeaders(headers);check(statusCode===101&&Buffer.isBuffer(body)&&body.length===0);
  check(values['content-type']==='application/vnd.docker.multiplexed-stream');
  check(values.upgrade?.toLowerCase()==='tcp'&&values.connection?.split(',').map(item=>item.trim().toLowerCase()).includes('upgrade'));
  check(values['transfer-encoding']===undefined&&(values['content-length']===undefined||values['content-length']==='0'));
  return true;
}

/** Untrusted Engine reports projected to value-free, closed review data. There
 * is no daemon authentication, cleanup, admission, or ownership authority here. */
export function projectProofDecoderEngineResponse(options) {
  const input=engineDataOptions(options,['apiVersion','plan','job','operation','statusCode','headers','body']);
  const {apiVersion,operation,statusCode,body}=input,{plan,job}=proofDecoderEngineContext(input);
  check(integer(statusCode,100,599)&&Buffer.isBuffer(body)&&body.length<=ENGINE_JSON_BYTES);
  const headers=responseHeaders(input.headers),base={schema:'atlas-proof-decoder-engine-observation-v1',classification:'UNQUALIFIED',executionAllowed:false,apiVersion,operation,profileHash:plan.profileHash,limitsHash:plan.limitsHash,job,statusCode,bodySha256:engineBytesHash(body)};
  const finish=(kind,data=null)=>decoderFreeze({...base,kind,data});
  if(operation==='ATTACH'&&statusCode===101){assertProofDecoderEngineUpgrade(input);return finish('ATTACH_UPGRADE_REPORTED');}
  if(operation==='START'&&statusCode===304){check(body.length===0);return finish('ENGINE_ERROR_REPORTED');}
  if([400,404,409,500].includes(statusCode)){
    check(isJSON(headers));const value=parseProofDecoderEngineJSON(body);check(object(value)&&typeof value.message==='string');
    return finish(statusCode===404?'NOT_FOUND_REPORTED':'ENGINE_ERROR_REPORTED');
  }
  if(['START','KILL','REMOVE'].includes(operation)){
    check(statusCode===204&&body.length===0);return finish(`${operation}_REPORTED`);
  }
  check(statusCode===(operation==='CREATE'?201:200)&&operation!=='ATTACH'&&isJSON(headers));
  const value=parseProofDecoderEngineJSON(body);check(object(value));
  if(operation==='CREATE'){
    check(id(value.Id)&&(value.Warnings===undefined||value.Warnings===null||(Array.isArray(value.Warnings)&&value.Warnings.length<=128&&value.Warnings.every(item=>typeof item==='string'))));
    return finish('CREATE_REPORTED',{containerId:value.Id,warningCount:value.Warnings?.length??0});
  }
  if(operation==='IMAGE_INSPECT'){
    check(imageId(value.Id)&&value.Os==='linux'&&value.Architecture===plan.profile.platform.split('/')[1]);
    check(Array.isArray(value.RepoDigests)&&value.RepoDigests.includes(plan.profile.image));check(object(value.Config));
    check(value.Config.Env===null||(Array.isArray(value.Config.Env)&&value.Config.Env.length===0));
    check(value.Config.Volumes===null||(object(value.Config.Volumes)&&Object.keys(value.Config.Volumes).length===0));
    return finish('IMAGE_REPORTED',{imageId:value.Id,platform:plan.profile.platform,imageDigest:plan.profile.image});
  }
  if(operation==='WAIT'){
    check(integer(value.StatusCode,0,255));
    if(value.Error!==undefined&&value.Error!==null){check(object(value.Error)&&typeof value.Error.Message==='string');if(value.Error.Message!=='')return finish('ENGINE_ERROR_REPORTED');}
    return finish('WAIT_REPORTED',{exitCode:value.StatusCode});
  }
  check(['LOOKUP','INSPECT'].includes(operation));
  check(id(value.Id)&&(job.containerId===null||value.Id===job.containerId)&&value.Name===`/${job.name}`&&imageId(value.Image));
  check(object(value.Config)&&value.Config.Image===plan.profile.image&&object(value.Config.Labels));
  for(const [key,expected] of Object.entries(proofDecoderEngineLabels(job)))check(value.Config.Labels[key]===expected);
  const state=value.State;check(object(state));
  check(['created','running','paused','restarting','removing','exited','dead'].includes(state.Status));
  check(['Running','Paused','Restarting','Dead','OOMKilled'].every(key=>typeof state[key]==='boolean'));
  check(integer(state.Pid,0,2147483647)&&integer(state.ExitCode,0,255)&&timestamp(state.StartedAt)&&timestamp(state.FinishedAt));
  // Do not persist Config.Env, raw error messages, paths, mounts or arbitrary
  // image/daemon response fields. These reports do not verify effective config.
  return finish('CONTAINER_REPORTED',{containerId:value.Id,name:job.name,imageId:value.Image,state:{status:state.Status,running:state.Running,paused:state.Paused,restarting:state.Restarting,dead:state.Dead,oomKilled:state.OOMKilled,pid:state.Pid,exitCode:state.ExitCode,startedAt:state.StartedAt,finishedAt:state.FinishedAt}});
}

/** Bounded Docker non-TTY output records. This does not decode PDW1 or imply
 * worker completion. Only explicit end() accepts record-level EOF. */
export function createProofDecoderEngineMultiplexReader(options={}) {
  const input=engineDataOptions(options,['onStdout','onStderr'],['stdoutLimit','stderrLimit','maxFrames']);
  const {onStdout,onStderr}=input,stdoutLimit=input.stdoutLimit===undefined?4104:input.stdoutLimit,stderrLimit=input.stderrLimit===undefined?4096:input.stderrLimit,maxFrames=input.maxFrames===undefined?256:input.maxFrames;
  check(typeof onStdout==='function'&&typeof onStderr==='function'&&integer(stdoutLimit,1,4104)&&integer(stderrLimit,1,4096)&&integer(maxFrames,1,256));
  const header=Buffer.alloc(8);let headerAt=0,payload=null,payloadAt=0,stream=null,frames=0,totalBytes=0,stdoutBytes=0,stderrBytes=0,stdoutStarted=false,ended=false,failed=false,disposed=false,active=false;
  const poison=()=>{failed=true;header.fill(0);payload?.fill(0);payload=null;check(false);};
  const guarded=run=>{try{check(!active);active=true;return run();}catch{return poison();}finally{active=false;}};
  return Object.freeze({
    feed(chunk){return guarded(()=>{
      check(!ended&&!failed&&!disposed&&Buffer.isBuffer(chunk));totalBytes+=chunk.length;check(totalBytes<=stdoutLimit+stderrLimit+8*maxFrames);let at=0;
      while(at<chunk.length){
        if(payload===null){
          // A prefix is already stdout arrival even before this header or its
          // payload completes. Callers enforce input-EOF ordering after feed.
          if(headerAt===0&&chunk[at]===1)stdoutStarted=true;
          const size=Math.min(8-headerAt,chunk.length-at);chunk.copy(header,headerAt,at,at+size);at+=size;headerAt+=size;if(headerAt<8)continue;
          stream=header[0];check((stream===1||stream===2)&&header.readUIntBE(1,3)===0&&++frames<=maxFrames);
          const length=header.readUInt32BE(4);check(length<=(stream===1?stdoutLimit-stdoutBytes:stderrLimit-stderrBytes));
          payload=Buffer.alloc(length);payloadAt=0;
        }
        const size=Math.min(payload.length-payloadAt,chunk.length-at);chunk.copy(payload,payloadAt,at,at+size);payloadAt+=size;at+=size;
        if(payloadAt===payload.length){const bytes=payload,kind=stream;payload=null;headerAt=0;payloadAt=0;stream=null;
          if(kind===1)stdoutBytes+=bytes.length;else stderrBytes+=bytes.length;
          if(bytes.length){(kind===1?onStdout:onStderr)(bytes);check(!failed&&!disposed);}
        }
      }
    });},
    end(){return guarded(()=>{check(!ended&&!failed&&!disposed&&headerAt===0&&payload===null);ended=true;return Object.freeze({classification:'UNQUALIFIED',executionAllowed:false,frames,stdoutBytes,stderrBytes,totalBytes});});},
    dispose(){disposed=true;header.fill(0);payload?.fill(0);payload=null;},
    status(){return {frames,totalBytes,stdoutBytes,stderrBytes,stdoutStarted,bufferedBytes:headerAt+payloadAt,allocatedBytes:8+(payload?.length??0),ended,failed,disposed};}
  });
}
