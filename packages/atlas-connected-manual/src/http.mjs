import { createWorkflowHandler } from '@atlas/manual-workflow/http';
import { createIntakeHandler } from '@atlas/manual-intake/http';
import { object, requireThat } from '@atlas/manual-service/contract';
import { createBatchHandler, isBatchPath } from '@atlas/batch-grading/http';

export function createConnectedHandler({connected,boundary,origin,assertRequest}) {
  const workflow=createWorkflowHandler({workflow:connected.workflow,boundary,origin,assertRequest,imageDescriptors:connected.imageDescriptors,workspaceExtras:connected.workspaceExtras});
  const intake=createIntakeHandler({service:connected.intake,boundary,origin,assertRequest});
  const batch=connected.batch?createBatchHandler({service:connected.batch,boundary,origin,assertRequest}):null;
  const stationRoute=/^\/api\/staff\/manual-connected\/stations(?:\/(challenge|enroll|arm|acknowledge|complete))?$/;
  const id='[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
  const assistanceRoute=new RegExp(`^/api/staff/manual-connected/cards/(${id})/(defect-analysis|defect-memory)(?:/(${id}))?$`);
  const publicationRoute=new RegExp(`^/api/staff/manual-connected/cards/(${id})/publication$`);
  const finishingRoute=new RegExp(`^/api/staff/manual-connected/cards/(${id})/finishing/(${id})$`);
  const presentationRoute=new RegExp(`^/api/staff/manual-connected/cards/(${id})/presentation(?:/(uploads|remove)(?:/(${id})/(sign|complete))?)?$`);
  const marketRoute=new RegExp(`^/api/staff/manual-connected/cards/(${id})/presentation/market/(search|select)$`);
  const route=new RegExp(`^/api/staff/manual-connected/cards/(${id})(?:/(details|identify|initialize|geometry|preview-image)(?:/(FRONT|BACK))?|/images/(FRONT|BACK)/(original|rectified|inspection|normalized|microDefect|directional)/([a-f0-9]{64}))?$`);
  return async(req,res)=>{
    const url=new URL(req.url,origin);
    if(!/^\/api\/staff\/(manual|manual-intake|manual-connected)(?:\/|$)/.test(url.pathname))return false;
    try{
      await assertRequest(req);requireThat(url.origin===origin,400,'MANUAL_REQUEST_INVALID');
      if(isBatchPath(url.pathname)){
        requireThat(batch,503,'BATCH_DISABLED');return batch(req,res);
      }
      if(req.method==='POST')requireThat(Buffer.byteLength(JSON.stringify(req.body??{})) <= (/\/(?:proposal-)?trace$/.test(url.pathname)?1048576:url.pathname.startsWith('/api/staff/manual-intake/')?8192:65536),413,'REQUEST_TOO_LARGE');
      const stationFound=stationRoute.exec(url.pathname);
      if(stationFound){
        const action=stationFound[1],write=Boolean(action);
        requireThat(!url.search && req.method===(write?'POST':'GET'),405,'METHOD_NOT_ALLOWED');
        if(write)requireThat(req.headers.origin===origin && /^application\/json(?:\s*;|$)/i.test(req.headers['content-type']??'')
          && typeof req.headers['x-atlas-csrf']==='string' && req.headers['x-atlas-csrf'],403,'CSRF_REQUIRED');
        const staff=await boundary.authenticate(req.headers.cookie??'',write?req.headers['x-atlas-csrf']:undefined);
        if(write)requireThat(connected.station,503,'FINISHING_STATION_DISABLED');
        const result=write?await connected.station[action](staff,req.body)
          :connected.station?await connected.station.list(staff):{enabled:false,stations:[]};
        res.setHeader('Cache-Control','private, no-store');res.status(200).json(result);return true;
      }
      if(await intake(req,res))return true;
      if(await workflow(req,res))return true;
      const marketFound=marketRoute.exec(url.pathname);
      if(marketFound){
        requireThat(!url.search && req.method==='POST',405,'METHOD_NOT_ALLOWED');
        requireThat(connected.market?.enabled,503,'MARKET_DISABLED');
        requireThat(req.headers.origin===origin && /^application\/json(?:\s*;|$)/i.test(req.headers['content-type']??'')
          && typeof req.headers['x-atlas-csrf']==='string' && req.headers['x-atlas-csrf'],403,'CSRF_REQUIRED');
        const staff=await boundary.authenticate(req.headers.cookie??'',req.headers['x-atlas-csrf']);
        const result=marketFound[2]==='search'?await connected.market.preview(staff,marketFound[1],req.body):await connected.market.select(staff,marketFound[1],req.body);
        res.setHeader('Cache-Control','private, no-store');res.status(200).json(result);return true;
      }
      const presentationFound=presentationRoute.exec(url.pathname);
      if(presentationFound){
        const [,cardId,action,uploadId,step]=presentationFound, write=Boolean(action);
        requireThat(!url.search && req.method===(write?'POST':'GET') && (!uploadId || action==='uploads'),405,'METHOD_NOT_ALLOWED');
        requireThat(connected.presentation,503,'PRESENTATION_DISABLED');
        if(write)requireThat(req.headers.origin===origin && /^application\/json(?:\s*;|$)/i.test(req.headers['content-type']??'')
          && typeof req.headers['x-atlas-csrf']==='string' && req.headers['x-atlas-csrf'],403,'CSRF_REQUIRED');
        const staff=await boundary.authenticate(req.headers.cookie??'',write?req.headers['x-atlas-csrf']:undefined);
        if(step)object(req.body,[]);
        const result=!action?await connected.presentation.status(staff,cardId)
          :action==='remove'?await connected.presentation.remove(staff,cardId,req.body)
          :!step?await connected.presentation.plan(staff,cardId,req.body)
          :step==='sign'?await connected.presentation.sign(staff,cardId,uploadId):await connected.presentation.complete(staff,cardId,uploadId);
        res.setHeader('Cache-Control','private, no-store');res.status(200).json(result);return true;
      }
      const finishingFound=finishingRoute.exec(url.pathname);
      if(finishingFound){
        requireThat(!url.search && req.method==='GET',405,'METHOD_NOT_ALLOWED');
        const staff=await boundary.authenticate(req.headers.cookie??'');
        const result=await connected.finishing.load(staff,finishingFound[1],finishingFound[2]);
        res.setHeader('Cache-Control','private, no-store');res.status(200).json(result);return true;
      }
      const publicationFound=publicationRoute.exec(url.pathname);
      if(publicationFound){
        requireThat(!url.search && req.method==='POST',405,'METHOD_NOT_ALLOWED');
        requireThat(req.headers.origin===origin && /^application\/json(?:\s*;|$)/i.test(req.headers['content-type']??'')
          && typeof req.headers['x-atlas-csrf']==='string' && req.headers['x-atlas-csrf'],403,'CSRF_REQUIRED');
        object(req.body,['actionId']);
        const staff=await boundary.authenticate(req.headers.cookie??'',req.headers['x-atlas-csrf']);
        const publication=await connected.publication.publish(staff,publicationFound[1],req.body.actionId);
        res.setHeader('Cache-Control','no-store');res.status(200).json({publication});return true;
      }
      const assistanceFound=assistanceRoute.exec(url.pathname);
      if(assistanceFound){
        const [,cardId,kind,analysisId]=assistanceFound;
        requireThat(!url.search && (!analysisId || kind==='defect-analysis'),404,'NOT_FOUND');
        const write=req.method==='POST';
        requireThat((write&&!analysisId)||(req.method==='GET'&&kind==='defect-analysis'),405,'METHOD_NOT_ALLOWED');
        if(write)requireThat(req.headers.origin===origin && /^application\/json(?:\s*;|$)/i.test(req.headers['content-type']??'')
          && typeof req.headers['x-atlas-csrf']==='string' && req.headers['x-atlas-csrf'],403,'CSRF_REQUIRED');
        const staff=await boundary.authenticate(req.headers.cookie??'',write?req.headers['x-atlas-csrf']:undefined);
        requireThat(connected.assistance,503,'DEFECT_ASSISTANCE_DISABLED');
        let result;
        if(kind==='defect-memory'){object(req.body,[]);result=await connected.assistance.publish(staff,cardId);}
        else result=write?await connected.assistance.analyze(staff,cardId,req.body):await connected.assistance.status(staff,cardId,analysisId??null);
        res.setHeader('Cache-Control','no-store');res.status(200).json(result);return true;
      }
      const found=route.exec(url.pathname);requireThat(found && !url.search,404,'NOT_FOUND');
      const [,cardId,action,previewSide,imageSide,kind,hash]=found;
      const write=['details','identify','initialize','geometry'].includes(action);
      requireThat(req.method===(write?'POST':'GET'),405,'METHOD_NOT_ALLOWED');
      if(write)requireThat(req.headers.origin===origin && /^application\/json(?:\s*;|$)/i.test(req.headers['content-type']??'')
        && typeof req.headers['x-atlas-csrf']==='string',403,'CSRF_REQUIRED');
      const staff=await boundary.authenticate(req.headers.cookie??'',write?req.headers['x-atlas-csrf']:undefined);
      let result;
      if(imageSide || action==='preview-image'){
        const image=imageSide?await connected.image(staff,cardId,imageSide,kind,hash):await connected.intakeImage(staff,cardId,previewSide);
        res.setHeader('Cache-Control','private, no-store');res.setHeader('Content-Type',image.contentType);
        res.setHeader('Content-Security-Policy',"default-src 'none'; sandbox");res.status(200).send(image.bytes);return true;
      }
      if(action==='details')result=await connected.details.save(staff,cardId,req.body);
      else if(action==='identify'){
        if(req.body && Object.keys(req.body).length){object(req.body,['actionId','expectedAttemptId','sourceHash']);result=await connected.identification.retry(staff,cardId,req.body);}
        else{object(req.body,[]);result=await connected.identification.run(staff,cardId);}
      }
      else if(action==='initialize')result=await connected.initialize(staff,cardId,req.body);
      else if(action==='geometry')result=await connected.earlyGeometry.ensure(staff,cardId,req.body);
      else result=await connected.open(staff,cardId);
      res.status(200).json(result);
    }catch(error){
      const known=Number.isInteger(error?.status)&&typeof error?.code==='string';
      const identity=error?.name==='SpeedsterIdentityValidationError';
      res.status(known?error.status:identity?400:503).json({error:known?error.code:identity?'MANUAL_IDENTITY_REQUIRED':'MANUAL_TEMPORARILY_UNAVAILABLE',...(identity?{fields:error.fields}:{})});
    }
    return true;
  };
}
