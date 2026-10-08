#!/usr/bin/env node
'use strict';
/** Offline, create-only activation signing. Never starts adapters or services. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),child=require('node:child_process');
const {canonicalJson}=require('../../vault-contracts/dist');
const {digest}=require('../dist/util');
const {buildSparkProvisioning,SPARK_PROMOTION_EVIDENCE,verifySparkPromotion}=require('../dist/spark-provisioning');
const {waveshareBindingDigest,validateWaveshareConfig}=require('../dist/waveshare-controller');
const {verifySparkActivation}=require('../dist/spark-activation');
const need=(test,code)=>{if(!test)throw new Error(code);};
function bytes(file,maximum=4*1024*1024){need(typeof file==='string'&&path.isAbsolute(file),'ABSOLUTE_PATH_REQUIRED');const stat=fs.lstatSync(file);need(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>0&&stat.size<=maximum,'REGULAR_BOUNDED_FILE_REQUIRED');return fs.readFileSync(file);}
const json=file=>JSON.parse(bytes(file));
const hash=buffer=>crypto.createHash('sha256').update(buffer).digest('hex');
function inputs(request){
  need(request.schemaVersion===1,'REQUEST_VERSION_INVALID');
  const provisioning=json(request.provisioningPath),controller=validateWaveshareConfig(json(request.controllerConfigPath));
  const activationPublicKey=bytes(request.activationPublicKeyPath).toString(),releasePublicKey=bytes(request.releasePublicKeyPath).toString();
  // Independent release verifier checks detached signature, every hash/mode/size,
  // exact membership and runtime pin before any activation signing-key access.
  child.execFileSync('python3',[path.resolve(__dirname,'../../../deploy/vault-linux/appliance.py'),'verify','--release',request.releasePath,'--public-key',request.releasePublicKeyPath],{stdio:['ignore','pipe','pipe'],timeout:60000,env:{PATH:process.env.PATH,PYTHONDONTWRITEBYTECODE:'1'}});
  const releaseManifest=bytes(path.join(request.releasePath,'release.json')),releaseSignature=bytes(path.join(request.releasePath,'release.sig'),64),sourceBuild=json(path.join(request.releasePath,'source-build.json'));
  const evidence=Object.fromEntries(SPARK_PROMOTION_EVIDENCE.map(kind=>[kind,{record:bytes(path.join(request.evidencePath,kind+'.evidence')),artifact:bytes(path.join(request.evidencePath,kind+'.artifact'),32*1024*1024)}]));
  const plan=buildSparkProvisioning(provisioning);
  return{provisioning,controller,activationPublicKey,releaseManifest,releaseSignature,releasePublicKey,sourceBuild,evidence,
    context:{machineId:plan.machineId,machineConfigDigest:request.machineConfigDigest,sourceCommit:JSON.parse(releaseManifest).sourceCommit,paymentBindingDigest:plan.bindingDigest,controllerBindingDigest:waveshareBindingDigest(controller)},now:Date.now()};
}
function main(){
  const [command,requestFile,keyOrEnvelope,output]=process.argv.slice(2);
  if(command==='--help'||!command){process.stdout.write('Offline activation: sign-promotion REQUEST_JSON PRIVATE_KEY NEW_OUTPUT | sign REQUEST_JSON PRIVATE_KEY NEW_OUTPUT | verify REQUEST_JSON ACTIVATION_JSON | evidence-templates PROVISIONING_JSON NEW_DIRECTORY\nRequest fields: schemaVersion=1, provisioningPath, controllerConfigPath, activationPublicKeyPath, releasePath, releasePublicKeyPath, evidencePath, machineConfigDigest; sign adds promotionPath, approvedBy, expiresAt; sign-promotion adds previousBindingDigest, approvedBy, promotionExpiresAt. All paths absolute. This never installs or activates a machine.\n');return;}
  if(command==='evidence-templates'){
    need(keyOrEnvelope&&path.isAbsolute(keyOrEnvelope)&&!fs.existsSync(keyOrEnvelope),'OUTPUT_MUST_BE_NEW_ABSOLUTE_PATH');
    const plan=buildSparkProvisioning(json(requestFile));need(plan.stage==='PRODUCTION','PRODUCTION_PROFILE_REQUIRED');fs.mkdirSync(keyOrEnvelope,{mode:0o700});
    for(const kind of SPARK_PROMOTION_EVIDENCE)fs.writeFileSync(path.join(keyOrEnvelope,kind+'.evidence'),JSON.stringify({schemaVersion:1,kind,outcome:'PENDING',evidenceClass:'UNREVIEWED',machineId:plan.machineId,sourceCommit:null,machineConfigDigest:null,paymentBindingDigest:kind==='TERMINAL_SANDBOX'?null:plan.bindingDigest,controllerBindingDigest:null,releaseManifestSha256:null,observedAt:null,reviewedAt:null,reviewedBy:null,artifactSha256:null},null,2)+'\n',{flag:'wx',mode:0o600});
    process.stdout.write(JSON.stringify({created:true,accepted:false,output:keyOrEnvelope,required:'Record actual reviewed results and matching KIND.artifact files before signing'})+'\n');return;
  }
  need(['sign-promotion','sign','verify'].includes(command),'COMMAND_INVALID');
  if(command!=='verify')need(output&&path.isAbsolute(output)&&!fs.existsSync(output),'OUTPUT_MUST_BE_NEW_ABSOLUTE_PATH');
  const request=json(requestFile),input=inputs(request);
  let envelope;
  if(command==='verify')envelope=json(keyOrEnvelope);
  else{
    const plan=buildSparkProvisioning(input.provisioning);
    const keyInfo=fs.lstatSync(keyOrEnvelope);need(keyInfo.isFile()&&!keyInfo.isSymbolicLink()&&(keyInfo.mode&0o077)===0,'SIGNING_KEY_MUST_BE_PRIVATE_REGULAR_FILE');
    const privateKey=crypto.createPrivateKey(bytes(keyOrEnvelope));need(privateKey.asymmetricKeyType==='ed25519','ED25519_REQUIRED');
    const sign=payload=>crypto.sign(null,Buffer.from(canonicalJson(payload)),privateKey).toString('base64');
    let promotion;
    if(command==='sign-promotion'){
      const payload={schemaVersion:1,purpose:'VAULT_SPARK_PRODUCTION_PROMOTION',machineId:plan.machineId,configurationDigest:plan.configurationDigest,previousBindingDigest:request.previousBindingDigest,targetBindingDigest:plan.bindingDigest,sourceCommit:input.context.sourceCommit,
        approvedBy:request.approvedBy,approvedAt:new Date(input.now).toISOString(),expiresAt:request.promotionExpiresAt,evidence:SPARK_PROMOTION_EVIDENCE.map(kind=>({kind,sha256:hash(input.evidence[kind].record)}))};
      promotion={payload,signature:sign(payload)};
    }else promotion=json(request.promotionPath);
    const verified=verifySparkPromotion(input.provisioning,promotion,input.activationPublicKey,Object.fromEntries(Object.entries(input.evidence).map(([kind,pair])=>[kind,hash(pair.record)])),input.now);
    const payload={schemaVersion:1,purpose:'VAULT_SPARK_RUNTIME_ACTIVATION',activationId:crypto.randomUUID(),machineId:plan.machineId,configurationDigest:plan.configurationDigest,machineConfigDigest:request.machineConfigDigest,
      paymentBindingDigest:plan.bindingDigest,controllerBindingDigest:input.context.controllerBindingDigest,sourceCommit:input.context.sourceCommit,releaseManifestSha256:hash(input.releaseManifest),promotionAuthorityDigest:verified.authorityDigest,
      activatedAt:new Date(input.now).toISOString(),expiresAt:command==='sign-promotion'?new Date(input.now+60000).toISOString():request.expiresAt,approvedBy:request.approvedBy};
    envelope={payload,promotion,signature:sign(payload)};
  }
  const verified=verifySparkActivation({...input,envelope});
  if(command!=='verify'){
    const fd=fs.openSync(output,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(command==='sign-promotion'?envelope.promotion:envelope,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    const directory=fs.openSync(path.dirname(output),'r');try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}
  }
  process.stdout.write(JSON.stringify({verified:true,purpose:command==='sign-promotion'?'PROMOTION':'RUNTIME_ACTIVATION',...(command==='sign-promotion'?{authorityDigest:digest(envelope.promotion.payload),expiresAt:envelope.promotion.payload.expiresAt}:{activationId:verified.activationId,expiresAt:verified.expiresAt}),bindingDigest:verified.bindingDigest,installed:false,...(output?{output}:{} )})+'\n');
}
try{main();}catch{process.stderr.write('Spark activation failed: verify trusted keys, exact signed release, fresh promotion, external acceptance reports and request fields. No machine activation was performed.\n');process.exitCode=1;}
