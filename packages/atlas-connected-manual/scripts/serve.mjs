import {PrismaClient} from '../../../frontend/atlas-app/.generated/staff-database/index.js';
import {privateManualAccessConfig} from '../../../frontend/atlas-app/lib/server/access/config.mjs';
import {StaffDatabase} from '../../../frontend/atlas-app/lib/server/access/database.mjs';
import {DurableStaffAuth} from '../../../frontend/atlas-app/lib/server/access/auth.mjs';
import {createServingConnectedManual} from '../../../frontend/atlas-app/lib/server/connected-manual-runtime.mjs';
import {createPrivateManualServer} from './private-server.mjs';
import {createAnalysisWorker} from './analysis-worker.mjs';
import {createManualPublicHandler} from '../src/publication-reader.mjs';

const env=process.env,config=privateManualAccessConfig(env);
const key=Buffer.from(env.ATLAS_MANUAL_SERVICE_KEY??'','base64');
if(key.length!==32||key.toString('base64')!==env.ATLAS_MANUAL_SERVICE_KEY||[config.sessionKey,config.phoneKey,config.routerKey].some(value=>key.equals(value)))throw new Error('Manual transport configuration invalid');
const publicKey=env.ATLAS_MANUAL_PUBLIC_READ_KEY===undefined?null:Buffer.from(env.ATLAS_MANUAL_PUBLIC_READ_KEY,'base64');
if(publicKey&&(publicKey.length!==32||publicKey.toString('base64')!==env.ATLAS_MANUAL_PUBLIC_READ_KEY||[key,config.sessionKey,config.phoneKey,config.routerKey].some(value=>publicKey.equals(value))))throw new Error('Manual public reader configuration invalid');
if(!/^\d{2,5}$/.test(env.PORT??'4319')||Number(env.PORT??4319)>65535)throw new Error('Manual port invalid');
const client=new PrismaClient({datasources:{db:{url:config.databaseUrl}},errorFormat:'minimal'});
const auth=new DurableStaffAuth({database:new StaffDatabase(client,config),config,provider:{}});
const runtime=createServingConnectedManual({env,auth,staffConfig:config,Client:PrismaClient,assertRequest(){throw new Error('Private signed transport required');}});
if(!runtime)throw new Error('Manual runtime is disabled');
const publicHandler=publicKey?createManualPublicHandler({key:publicKey,reader:runtime.approvedManualReader}):null;
const server=createPrivateManualServer({connected:runtime.connected,boundary:runtime.boundary,origin:config.origin,key,publicHandler});
const analysisWorker=runtime.analysisReconciler?createAnalysisWorker({reconciler:runtime.analysisReconciler,
  onEvent:event=>console.log(JSON.stringify(event))}):null;
server.listen(Number(env.PORT??4319),'0.0.0.0',()=>{
  console.log(JSON.stringify({event:'MANUAL_PRIVATE_LISTENING',webDeployment:config.deploymentId,webReleaseSha:config.releaseSha,port:Number(env.PORT??4319),node:process.version,platform:process.platform,arch:process.arch}));
  if(!stopping){analysisWorker?.start();runtime.connected.earlyGeometry.start();}
});
let stopping=false;
async function stop(){
 if(stopping)return;stopping=true;
 const workerStopped=analysisWorker?.stop();
 const geometryStopped=runtime.connected.earlyGeometry.stop();
 const deadline=setTimeout(()=>server.closeAllConnections(),215000);deadline.unref();
 await new Promise(resolve=>server.close(resolve));clearTimeout(deadline);
 await workerStopped;
 await geometryStopped;
 await Promise.all([runtime.close(),client.$disconnect()]);
}
process.once('SIGTERM',()=>void stop());process.once('SIGINT',()=>void stop());
