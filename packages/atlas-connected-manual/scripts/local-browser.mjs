// Owned disposable integration harness. Never loaded by the serving runtime.
import {createServer} from 'node:http';
import {createServer as createHttpsServer,request as httpsRequest} from 'node:https';
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {Readable} from 'node:stream';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {createOwnedManualFixture} from '../../atlas-manual-service/scripts/owned-fixture.mjs';
import {intakeGrantSQL} from '../../atlas-manual-intake/src/repository.mjs';
import {connectedGrantSQL} from '../src/details.mjs';
import {createPhotoStorage} from '@atlas/photo-storage';
import {createConnectedManual} from '../src/index.mjs';
import {createManualServiceProxy} from '../src/transport.mjs';
import {createPrivateManualServer} from './private-server.mjs';
import {digest} from '@atlas/manual-service/contract';
import {assertLocalRequest,fixtureCookie} from '../../../frontend/atlas-app/lib/server/policy.mjs';

const evidence=resolve(process.env.ATLAS_CONNECTED_EVIDENCE),root=resolve(new URL('../../../',import.meta.url).pathname);
await mkdir(evidence,{recursive:true});
const fixture=await createOwnedManualFixture(process.argv.slice(2));
let server,uploadServer,app,connection,privateServer,geometryWorker;
try{
  await fixture.cluster.sql(intakeGrantSQL('atlas_fixture_manual')+'\n'+connectedGrantSQL('atlas_fixture_manual'),[],fixture.database.name);
  connection=fixture.connect();
  const objects=new Map(),grants=new Map(),objectDirectory=join(evidence,'objects');await mkdir(objectDirectory,{recursive:true});
  const missing=()=>Object.assign(new Error('NoSuchKey'),{name:'NoSuchKey',$metadata:{httpStatusCode:404}});
  async function put(input){
    const key=input.Key,bytes=Buffer.from(input.Body);
    if(objects.has(key))throw Object.assign(new Error('PreconditionFailed'),{name:'PreconditionFailed',$metadata:{httpStatusCode:412}});
    if(bytes.length!==input.ContentLength || digest(bytes)!==Buffer.from(input.ChecksumSHA256,'base64').toString('hex'))throw new Error('Checksum mismatch');
    const path=join(objectDirectory,digest(key));await writeFile(path,bytes,{flag:'wx',mode:0o600});
    const value={path,ContentLength:bytes.length,ContentType:input.ContentType,Metadata:input.Metadata,ChecksumSHA256:input.ChecksumSHA256,ETag:`"${digest(bytes)}"`};
    objects.set(key,value);await writeFile(`${path}.json`,JSON.stringify({key,...value}),{mode:0o600});return {};
  }
  const objectClient={async send(command){const input=command.input;if(command.constructor.name==='PutObjectCommand')return put(input);
    const found=objects.get(input.Key);if(!found)throw missing();if(input.IfMatch && input.IfMatch!==found.ETag)throw new Error('Object changed');
    return {...found,...(command.constructor.name==='GetObjectCommand'?{Body:Readable.from([await readFile(found.path)])}:{})};}};
  uploadServer=createHttpsServer({key:await readFile(join(evidence,'local.key')),cert:await readFile(join(evidence,'local.crt'))},async(req,res)=>{
    res.setHeader('Access-Control-Allow-Origin','http://127.0.0.1:4318');res.setHeader('Vary','Origin');
    if(req.url.startsWith('/api/staff/')){privateServer.emit('request',req,res);return;}
    res.setHeader('Access-Control-Allow-Methods','GET,PUT,OPTIONS');res.setHeader('Access-Control-Allow-Headers','content-type,if-none-match,x-amz-checksum-sha256,x-amz-meta-atlas-kind,x-amz-meta-atlas-binding-sha256');
    if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
    try{const grant=grants.get(req.url),input=grant?.input;if(!input||grant.method!==req.method)throw new Error('Invalid object grant');
      if(req.method==='GET'){const found=objects.get(input.Key);if(!found)throw missing();res.writeHead(200,{'Content-Type':found.ContentType,'Content-Length':found.ContentLength});res.end(await readFile(found.path));return;}
      if(req.headers.origin!=='http://127.0.0.1:4318')throw new Error('Invalid upload origin');
      if(req.headers['if-none-match']!=='*'||req.headers['x-amz-checksum-sha256']!==input.ChecksumSHA256)throw new Error('Missing integrity header');
      let length=0;const chunks=[];for await(const chunk of req){length+=chunk.length;if(length>input.ContentLength)throw new Error('Upload too large');chunks.push(chunk);}
      await put({...input,Body:Buffer.concat(chunks)});res.writeHead(200);res.end();
    }catch(error){res.writeHead(error?.$metadata?.httpStatusCode??400);res.end();}
  });
  await new Promise((done,reject)=>{uploadServer.once('error',reject);uploadServer.listen(4320,'127.0.0.1',done);});
  const storage=createPhotoStorage({client:objectClient,bucket:'atlas-local-objects',keyPrefix:'atlas-connected',limits:{maxObjectBytes:256*1024*1024,timeoutMs:90000},
    sign:async(_client,command)=>{const path=`/upload/${randomUUID()}`;grants.set(path,{input:command.input,method:command.constructor.name==='GetObjectCommand'?'GET':'PUT'});return `https://127.0.0.1:4320${path}`;}});
  const effects={ocr:async()=>({status:200,bytes:Buffer.from(JSON.stringify({responses:[{fullTextAnnotation:{text:'Synthetic Player 2026 Fixture Test 007'}}]}))}),
    model:async()=>({status:200,bytes:Buffer.from(JSON.stringify({model:'gpt-6-astra',status:'completed',error:null,incomplete_details:null,output:[{type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify(Object.fromEntries(Object.entries({name:'Synthetic Player',category:'Sports cards',manufacturer:'Fixture',card_number:'007',year:'2026',set_name:'Test Set',variant:null,card_type:'Basketball'}).map(([key,value])=>[key,{value,confidence:value?'high':'unknown',evidence:value?'Front printed test text':null}])))}]}],usage:{input_tokens:100,output_tokens:100,total_tokens:200}}))})};
  const connected=createConnectedManual({boundary:connection.boundary,storage,artifacts:fixture.artifacts,keyPrefix:'atlas-connected',pythonExecutable:process.env.ATLAS_MANUAL_PYTHON,effects,receiptClient:connection.manualClient,imageReadUrl:({kind,descriptor,photo})=>kind==='original'?storage.createDecodedFrameRead({frame:descriptor,original:photo.original,decodePlan:photo.decodePlan}):storage.createDerivativeRead({descriptor,frame:photo.workingFrame,original:photo.original,decodePlan:photo.decodePlan})});
  geometryWorker=connected.earlyGeometry;geometryWorker.start();
  const assertRequest=req=>assertLocalRequest(req,{NODE_ENV:'development',ATLAS_LOCAL_SYNTHETIC:'1'});
  const key=Buffer.alloc(32,87);
  privateServer=createPrivateManualServer({connected,boundary:connection.boundary,origin:fixture.config.origin,key});
  const fixtureCa=await readFile(join(evidence,'local.crt'));
  // The fixture trusts only its own self-signed loopback certificate. Production uses standard fetch/TLS.
  const fetchImpl=(url,options)=>new Promise((done,reject)=>{
    const request=httpsRequest(url,{method:options.method,headers:options.headers,ca:fixtureCa,signal:options.signal},response=>{
      done(new Response(Readable.toWeb(response),{status:response.statusCode,headers:response.headers}));
    });request.once('error',reject);request.end(options.body);
  });
  const proxy=createManualServiceProxy({origin:'https://127.0.0.1:4320',key,fetchImpl,timeoutMs:210000});
  const handler=async(req,res)=>{await assertRequest(req);const url=req.url;req.url=url.replace(/^\/admin(?=\/api\/)/,'');try{if(req.method==='GET'&&(req.body===''||(req.body&&Object.getPrototypeOf(req.body)===Object.prototype&&Object.keys(req.body).length===0))&&!req.headers['transfer-encoding']&&(!req.headers['content-length']||req.headers['content-length']==='0'))req.body=undefined;return await proxy(req,res);}finally{req.url=url;}};
  globalThis[Symbol.for('atlas.staff.connected.local-fixture')]={auth:connection.auth,mode:'LOCAL_FIXTURE',origin:fixture.config.origin,cookies:fixture.config.cookies,cookie:fixtureCookie,assertRequest,
    connectedManual:{handler,connected,uploadOrigin:'https://127.0.0.1:4320'},clientAddress:req=>req.socket.remoteAddress};
  process.env.NODE_ENV='development';process.env.ATLAS_CONNECTED_LOCAL_FIXTURE='1';process.env.ATLAS_MANUAL_UPLOAD_ORIGIN='https://127.0.0.1:4320';
  const require=createRequire(join(root,'frontend/atlas-app/package.json'));const next=require('next');
  app=next({dev:true,dir:join(root,'frontend/atlas-app'),hostname:'127.0.0.1',port:4318});await app.prepare();
  server=createServer(app.getRequestHandler());server.requestTimeout=240000;
  await new Promise((done,reject)=>{server.once('error',reject);server.listen(4318,'127.0.0.1',done);});
  await writeFile(join(evidence,'server-start.json'),JSON.stringify({pid:process.pid,origin:fixture.config.origin,path:'/admin/manual',ownedDatabase:fixture.cluster.directory,at:new Date().toISOString(),provider:'synthetic OCR/model; actual signed private HTTPS proxy and direct image grants; fixture object storage'}));
  console.log('Connected actual Next staff app ready at http://127.0.0.1:4318/admin');
  await new Promise(done=>{process.once('SIGTERM',done);process.once('SIGINT',done);});
}finally{
  await geometryWorker?.stop();
  for(const instance of [server,uploadServer])if(instance?.listening)await new Promise(done=>{instance.closeAllConnections();instance.close(done);});
  await fixture.stop();await copyFile(join(fixture.cluster.directory,'cleanup.json'),join(evidence,'database-cleanup.json'));
  await Promise.race([app?.close(),new Promise(done=>setTimeout(done,5000))]);
  await writeFile(join(evidence,'server-cleanup.json'),JSON.stringify({pid:process.pid,serverClosed:true,uploadClosed:true,ownedDatabaseStopped:true,at:new Date().toISOString()}));
  process.exit(0);
}
