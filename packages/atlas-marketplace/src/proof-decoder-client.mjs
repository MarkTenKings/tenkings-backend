import {createConnection} from 'node:net';
import {isAbsolute} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {PROOF_DECODER_PROTOCOL,PROOF_DECODER_FRAME_BYTES,proofDecoderLimits,proofDecoderLimitsHash,assertProofDecoderPlan,createProofDecoderFrameReader,encodeProofDecoderFrame} from './proof-decoder-protocol.mjs';

const clients=new WeakSet();
const error=code=>Object.assign(new Error(code),{code,classification:'UNQUALIFIED'});
const check=(value,code='PROOF_DECODER_PROTOCOL')=>{if(!value)throw error(code);};
const failure=value=>{if(value?.code==='PROOF_DECODER_PROTOCOL')return error(value.code);return error('PROOF_DECODER_TRANSPORT');};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const idleClose=()=>Object.freeze({classification:'UNQUALIFIED',closed:true,reportedCleanup:'NOT_STARTED',cleanupUncertain:false,occupiedSlots:0});

/** A protocol experiment, never a proof validator or an admitted physical port.
 * Expected hashes/epochs and REAPED are unverified caller/peer assertions.
 * No retry, environment discovery, readiness callback, or promotion API exists.
 */
export function createProofDecoderClient(options={}){
  if(options.enabled!==true)return Object.freeze({classification:'UNQUALIFIED',status:()=>({classification:'UNQUALIFIED',state:'DISABLED',active:0,occupiedSlots:0,cleanupUncertain:false}),async validate(){throw error('PROOF_DECODER_DISABLED');},async close(){return idleClose();}});
  check(Object.keys(options).every(key=>['enabled','socketPath','expectedQualificationHash','expectedEpoch','limits'].includes(key)),'PROOF_DECODER_CONFIGURATION');
  const {socketPath,expectedQualificationHash,expectedEpoch}=options;
  check(typeof socketPath==='string'&&isAbsolute(socketPath)&&!socketPath.includes('\0')&&Buffer.byteLength(socketPath)<=100&&typeof expectedQualificationHash==='string'&&/^[a-f0-9]{64}$/.test(expectedQualificationHash)&&typeof expectedEpoch==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(expectedEpoch),'PROOF_DECODER_CONFIGURATION');
  let limits;try{limits=proofDecoderLimits(options.limits);}catch{throw error('PROOF_DECODER_CONFIGURATION');}
  const limitsHash=proofDecoderLimitsHash(limits),jobs=new Set();let closed=false,quarantined=false,uncertainSlots=0,closePromise=null;
  const state=()=>({classification:'UNQUALIFIED',state:closed?'CLOSED':quarantined?'QUARANTINED':'OPEN',active:jobs.size,occupiedSlots:jobs.size+uncertainSlots,cleanupUncertain:uncertainSlots>0,quarantined,limits:{...limits},limitsHash,expectedQualificationHash,expectedEpoch});
  const client=Object.freeze({classification:'UNQUALIFIED',limits,
    status:state,
    async validate(input={}){
      const started=performance.now(),deadline=started+limits.timeoutMs;
      check(!closed,'PROOF_DECODER_CLOSED');check(!quarantined,'PROOF_DECODER_QUARANTINED');check(jobs.size+uncertainSlots<limits.maxConcurrent,'PROOF_DECODER_BUSY');
      // Copy all mutable caller inputs before the first await or socket action.
      const suppliedBytes=input.bytes;check(Buffer.isBuffer(suppliedBytes)&&suppliedBytes.length>0&&suppliedBytes.length<=limits.maxObjectBytes,'PROOF_SOURCE_MISMATCH');const bytes=Buffer.from(suppliedBytes);
      let plan;try{assertProofDecoderPlan(input.plan);plan=Object.freeze({byteCount:input.plan.byteCount,sha256:input.plan.sha256,declaredType:input.plan.declaredType});check(bytes.length===plan.byteCount&&bytes.length<=limits.maxObjectBytes&&digest(bytes)===plan.sha256,'PROOF_SOURCE_MISMATCH');}catch(cause){bytes.fill(0);throw error(cause?.code==='PROOF_SOURCE_MISMATCH'?'PROOF_SOURCE_MISMATCH':'PROOF_DECODER_PROTOCOL');}
      const signal=input.signal;if(!(signal===undefined||signal instanceof AbortSignal)){bytes.fill(0);throw error('PROOF_DECODER_CONFIGURATION');}
      if(signal?.aborted){bytes.fill(0);throw error('PROOF_DECODER_CANCELLED');}
      if(performance.now()>=deadline){bytes.fill(0);throw error('PROOF_VALIDATOR_TIMEOUT');}
      return new Promise((resolve,reject)=>{
        const requestId=randomUUID();let socket,timer,settled=false,sentStart=false,accepted=false,sentBytes=0,completedBytes=0,localClosed=false,finalOutcome=null,stage='HELLO',terminal=null,cancelReason=null,cancelSent=false,finished;
        const job={done:new Promise(done=>{finished=done;}),cancel:reason=>cancel(reason)};jobs.add(job);
        function finish(err,result,{uncertain=false,quarantine=false}={}){
          if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);bytes.fill(0);finalOutcome={err,result,uncertain,quarantine};if(quarantine||uncertain)quarantined=true;socket?.destroy();if(!socket||localClosed)complete();
        }
        function complete(){if(!finalOutcome)return;const {err,result,uncertain,quarantine}=finalOutcome;finalOutcome=null;jobs.delete(job);if(uncertain)uncertainSlots++;if(quarantine||uncertain)quarantined=true;finished();if(err)reject(err);else resolve(result);}
        const unknown=code=>finish(error(code),null,{uncertain:sentStart,quarantine:sentStart});
        const abort=()=>cancel('PROOF_DECODER_CANCELLED');
        function write(type,value){
          if(settled)return Promise.reject(error('PROOF_DECODER_CLOSED'));
          return new Promise((accept,refuse)=>socket.write(encodeProofDecoderFrame(type,value),cause=>cause?refuse(cause):accept()));
        }
        function cancel(reason){
          if(settled)return;cancelReason??=reason;
          if(!sentStart){finish(error(cancelReason));return;}
          if(!cancelSent){cancelSent=true;void write('CANCEL',{requestId}).catch(()=>unknown('PROOF_DECODER_CLEANUP_UNCONFIRMED'));}
        }
        function same(value){check(value.qualificationHash===expectedQualificationHash&&value.epoch===expectedEpoch&&(!Object.hasOwn(value,'requestId')||value.requestId===requestId));}
        async function sendBytes(){
          try{while(sentBytes<bytes.length&&!settled&&!cancelReason&&!terminal){const end=Math.min(bytes.length,sentBytes+PROOF_DECODER_FRAME_BYTES),part=bytes.subarray(sentBytes,end);sentBytes=end;await write('DATA',part);completedBytes+=part.length;}if(!settled&&!terminal)stage='TERMINAL';}
          catch{if(!settled)unknown('PROOF_DECODER_CLEANUP_UNCONFIRMED');}
        }
        const reader=createProofDecoderFrameReader({allowedTypes:['HELLO','ACCEPT','TERMINAL'],maxFrames:3,maxTotalBytes:10000,onFrame(type,value){
          check(!terminal);same(value);
          if(type==='HELLO'){
            check(stage==='HELLO'&&value.schema===PROOF_DECODER_PROTOCOL&&value.limitsHash===limitsHash);stage='ACCEPT';sentStart=true;
            void write('START',{schema:PROOF_DECODER_PROTOCOL,requestId,qualificationHash:expectedQualificationHash,epoch:expectedEpoch,limitsHash,plan}).catch(()=>unknown('PROOF_DECODER_CLEANUP_UNCONFIRMED'));
          }else if(type==='ACCEPT'){
            check(stage==='ACCEPT');accepted=true;stage='DATA';if(!cancelReason)void sendBytes();
          }else{
            check(sentStart&&['ACCEPT','DATA','TERMINAL'].includes(stage));check(value.workerState!=='NOT_STARTED'||!accepted);check(value.workerState!=='REAPED'||accepted);
            if(value.outcome==='BUSY')check(!accepted);
            if(['SUCCESS','INVALID_IMAGE'].includes(value.outcome))check(accepted&&completedBytes===bytes.length&&value.workerState==='REAPED');
            if(value.outcome==='SUCCESS'){const valid=value.validation;check(valid.sha256===plan.sha256&&valid.byteCount===plan.byteCount&&valid.contentType===plan.declaredType&&valid.width*valid.height<=limits.maxPixels);}
            terminal=value;stage='END';
          }
        }});
        timer=setTimeout(()=>unknown('PROOF_VALIDATOR_TIMEOUT'),Math.max(1,deadline-performance.now()));
        signal?.addEventListener('abort',abort,{once:true});
        try{
          socket=createConnection({path:socketPath,allowHalfOpen:true});
          socket.on('data',chunk=>{if(settled)return;if(performance.now()>=deadline){unknown('PROOF_VALIDATOR_TIMEOUT');return;}try{reader.feed(chunk);}catch{finish(error('PROOF_DECODER_PROTOCOL'),null,{uncertain:sentStart,quarantine:true});}});
          socket.on('end',()=>{
            if(settled)return;if(performance.now()>=deadline){unknown('PROOF_VALIDATOR_TIMEOUT');return;}
            try{reader.end();if(!terminal){unknown('PROOF_DECODER_CLEANUP_UNCONFIRMED');return;}if(terminal.workerState==='UNKNOWN'||terminal.outcome==='CONTAINMENT_FAILURE'){finish(error('PROOF_DECODER_CONTAINMENT_FAILURE'),null,{uncertain:sentStart,quarantine:true});return;}
              if(cancelReason){finish(error(cancelReason));return;}
              if(terminal.outcome==='SUCCESS'){finish(null,Object.freeze({classification:'UNQUALIFIED',validation:Object.freeze({...terminal.validation}),reportedCleanup:'REAPED'}));return;}
              const codes={BUSY:'PROOF_VALIDATOR_BUSY',INVALID_IMAGE:'PROOF_IMAGE_INVALID',CANCELLED:'PROOF_DECODER_CANCELLED',TIMEOUT:'PROOF_VALIDATOR_TIMEOUT'};finish(error(codes[terminal.outcome]??'PROOF_DECODER_PROTOCOL'));
            }catch{finish(error('PROOF_DECODER_PROTOCOL'),null,{uncertain:sentStart,quarantine:true});}
          });
          socket.on('error',cause=>{if(!settled)finish(failure(cause),null,{uncertain:sentStart,quarantine:sentStart});});
          socket.on('close',()=>{localClosed=true;if(!settled)unknown('PROOF_DECODER_CLEANUP_UNCONFIRMED');else complete();});
        }catch{finish(error('PROOF_DECODER_TRANSPORT'),null,{uncertain:sentStart,quarantine:sentStart});}
      });
    },
    close(){
      if(!closePromise){closed=true;const pending=[...jobs];for(const job of pending)job.cancel('PROOF_DECODER_CLOSED');closePromise=Promise.all(pending.map(job=>job.done)).then(()=>Object.freeze({classification:'UNQUALIFIED',closed:true,localSocketsClosed:true,reportedCleanup:uncertainSlots?'UNCONFIRMED':'ACKNOWLEDGED_OR_NOT_STARTED',cleanupUncertain:uncertainSlots>0,occupiedSlots:uncertainSlots}));}
      return closePromise;
    },
  });clients.add(client);return client;
}
