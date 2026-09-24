const SIDES=['FRONT','BACK'];
export function geometryIsProcessing(snapshot){
  return SIDES.some(side=>['QUEUED','RUNNING'].includes(snapshot?.earlyGeometry?.[side]?.state));
}
export function earlyGeometryIdentity(snapshot){
  if(!snapshot?.earlyGeometry||!SIDES.some(side=>snapshot.card?.sides?.[side]?.upload?.source))return null;
  return JSON.stringify(SIDES.map(side=>[snapshot.card.sides[side]?.upload?.uploadId??null,
    snapshot.earlyGeometry[side]?.key??null,snapshot.details?.matColor,snapshot.details?.cornerShape]));
}
/** Photo work is durable on the server. This coordinator only reconciles an
 * authenticated reopening and reads progress; it never creates a manual draft. */
export function createEarlyGeometryClient({request,read,onError=()=>{},isVisible=()=>true,clock=()=>Date.now()}){
  const ensured=new Set(),ensuring=new Set(),pending=new Map(),retrying=new Set();
  let disposed=false,reading=false,denied=false,failures=0,nextReadAt=0,needsRead=false,reconciliation=0;
  const active=()=>!disposed&&!denied;
  const unauthorized=error=>[401,403].includes(error?.status);
  const transient=error=>!error?.status||error.status===429||error.status>=500;
  const backoff=attempt=>Math.min(30000,2000*2**Math.min(attempt-1,4));
  const requireRead=()=>{reconciliation++;needsRead=true;};
  function report(error){
    if(!active())return;
    if(unauthorized(error)){denied=true;pending.clear();}
    onError(error);
  }
  async function refresh(now){
    if(!active()||reading)return;
    reading=true;needsRead=true;const revision=reconciliation;
    try{await read();if(active()){failures=0;nextReadAt=now+2000;needsRead=revision!==reconciliation;}}
    catch(error){
      if(active()){failures++;nextReadAt=now+backoff(failures+1);if(unauthorized(error))report(error);}
      throw error;
    }finally{reading=false;}
  }
  async function ensure(snapshot,now=clock()){
    const identity=earlyGeometryIdentity(snapshot);
    if(!active()||!identity||ensured.has(identity)||ensuring.has(identity)||now<(pending.get(identity)?.nextAt??0))return;
    ensuring.add(identity);
    try{
      try{await request({});}
      catch(error){
        if(active()){
          if(transient(error)){
            const attempts=(pending.get(identity)?.attempts??0)+1;
            pending.set(identity,{attempts,nextAt:now+backoff(attempts)});requireRead();
          }else{pending.delete(identity);ensured.add(identity);}
          report(error);
        }
        return;
      }
      // A failed refresh cannot turn an acknowledged scheduling POST into a retry.
      ensured.add(identity);pending.delete(identity);requireRead();
      try{await refresh(now);}catch(error){if(!unauthorized(error))report(error);}
    }finally{ensuring.delete(identity);}
  }
  async function poll(snapshot,now=clock()){
    if(!active()||reading||!isVisible())return;
    // Only retry an uncertain idempotent ensure for the currently selected photo
    // identity. Terminal detector outcomes require the explicit retry below.
    const identity=earlyGeometryIdentity(snapshot);
    if(pending.has(identity))await ensure(snapshot,now);
    if(!active()||now<nextReadAt||(!needsRead&&!geometryIsProcessing(snapshot)))return;
    try{await refresh(now);}catch{/* The next visible poll uses the read backoff. */}
  }
  async function retry(side,status){
    if(!active()||!SIDES.includes(side)||!status?.key||status.canRetry!==true)return;
    const identity=`${side}:${status.key}`;
    if(retrying.has(identity))return;
    retrying.add(identity);
    try{
      let result;
      try{result=await request({side,expectedKey:status.key});}
      catch(error){
        if(unauthorized(error))report(error);
        else if(active()){
          // A lost POST reply may already have started work. Read its state,
          // never silently submit another detector retry.
          requireRead();try{await refresh(clock());}catch{/* Keep the original request error. */}
        }
        throw error;
      }
      if(active()){failures=0;nextReadAt=0;requireRead();await refresh(clock());}
      return result;
    }finally{retrying.delete(identity);}
  }
  return {ensure,poll,retry,dispose(){disposed=true;}};
}
