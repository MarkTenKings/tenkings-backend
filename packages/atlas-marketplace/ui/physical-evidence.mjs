import {PARCEL_PRESETS,estimateParcelPreset,WHATNOT_CARD_PROFILE_BENCHMARK} from './parcel-presets.mjs';
const h=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const id=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
const date=value=>Number.isSafeInteger(value)?new Date(value).toLocaleString():'Not recorded';
const labels={RETURN_REQUEST:'Return request photos',PACK:'Packing and holder photos',RELEASE:'Proceeds release review',RETURN_INSPECTION:'Returned parcel and card inspection',RETURN_REVIEW:'Return decision evidence',REFUND_REVIEW:'Refund allocation review'};
function parcelPlanner(orderId,ui,blocked) {
  const value=ui.parcelEstimates?.[orderId],p=value?.parcel;
  return `<details><summary>Packing size comparison</summary><form data-form="parcel-estimate" data-order="${h(orderId)}"><label>Published box size<select name="presetId">${PARCEL_PRESETS.map(row=>`<option value="${row.id}" ${value?.presetId===row.id?'selected':''}>${h(row.name)} · ${row.dimensions.lengthInches} × ${row.dimensions.widthInches} × ${row.dimensions.heightInches} in</option>`).join('')}</select></label><label>Comparison packed weight (oz)<input type="number" name="weightOunces" min="0.01" max="2400" step="any" value="${h(p?.weightOunces??'')}" required></label><button class="button secondary" ${blocked?'disabled':''}>Use comparison preset</button></form>${p?`<p><strong>Planning estimate:</strong> ${p.lengthInches} × ${p.widthInches} × ${p.heightInches} in; ${p.weightOunces} oz.</p><p class="small">${h(value.serviceNote)}</p>`:''}<p class="small">Box dimensions come from <a href="https://www.fedex.com/en-us/shipping/one-rate.html" target="_blank" rel="noopener noreferrer">FedEx</a>. Confirm the sealed package’s dimensions and full packed weight before buying a label. FedEx branded boxes require eligible FedEx services.</p><p class="small"><a href="${WHATNOT_CARD_PROFILE_BENCHMARK.source}" target="_blank" rel="noopener noreferrer">Whatnot’s 0–1 oz card profile</a> adds 0.5 oz per bundled item. That profile is not a packed slab weight.</p></details>`;
}
const button=(action,label,attrs,blocked)=>`<button type="button" class="button secondary" data-action="${action}" ${attrs} ${blocked?'disabled':''}>${label}</button>`;
export function renderPhysicalEvidence(data,ui={}) {
  const role=data?.scope?.role,staff=role==='STAFF',allowed=staff||role==='BUYER';
  if(!allowed||data.runtime==='LOCAL_DEMO'||!data.proofsEnabled&&!data.shippingTrackingEnabled)return '';
  const orders=Array.isArray(data.orders)?data.orders:[],blocked=!!(ui.busy||ui.uncertain),api=ui.apiPath;
  if(!/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(api??''))return '';
  return `<section class="workflow-section" id="physical-evidence"><div class="section-heading"><h2>${staff?'Order photos and carrier records':'Return photos'}</h2><p>${staff?'Retain the original photos, review them, and check the original shipment’s carrier events.':'Upload clear photos of the product and packaging for your return request. ATLAS staff will review your evidence.'}</p></div>${orders.map(order=>{
    const attrs=`data-order="${h(order.orderId)}"`,proofs=ui.proofOrders?.[order.orderId],shipping=ui.shippingOrders?.[order.orderId];
    const rows=Array.isArray(proofs?.proofs)?proofs.proofs:[],shipments=Array.isArray(shipping)?shipping:Array.isArray(shipping?.shipments)?shipping.shipments:[];
    return `<article class="panel"><h3>${h(order.approvedCard?.identity?.name??'Order')}</h3><p class="small">${h(order.orderId)}</p>${data.proofsEnabled?`${button('load-proofs','View saved photos',attrs,blocked)}${proofs?`<form data-form="proof-upload" ${attrs}><label>${staff?'Evidence purpose':'Photo purpose'}<select name="purpose" ${blocked?'disabled':''}>${Object.entries(labels).filter(([key])=>staff?key!=='RETURN_REQUEST':key==='RETURN_REQUEST').map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select></label><label>Original PNG or JPEG<input name="photo" type="file" accept="image/png,image/jpeg" required ${blocked?'disabled':''}></label><p class="small">Maximum ${h(Math.floor((proofs.limits?.maxObjectBytes??0)/1048576))} MB. Saving a photo records your evidence; it does not approve a return.</p><button class="button secondary" type="submit" ${blocked?'disabled':''}>Save original photo</button></form>${rows.map(row=>`<div class="case-panel"><p><strong>${h(labels[row.purpose]??row.purpose)}</strong> · ${h(row.status)} · Review: ${h(row.reviewStatus)}</p><p class="small">Saved ${h(date(row.createdAt))}</p>${id(row.proofId)?`<a class="report-link" href="${api}/proofs/objects/${row.proofId}" target="_blank" rel="noopener noreferrer">View retained photo ↗</a><p class="small">Evidence reference: <code>${h(row.proofId)}</code></p>${!staff&&row.purpose==='RETURN_REQUEST'?button('use-return-proof','Use for return request',`${attrs} data-proof="${h(row.proofId)}"`,blocked):''}`:''}${id(row.uploadId)&&['PREPARED','VALIDATING','VALIDATED'].includes(row.status)?button('recover-proof','Check this original upload',`${attrs} data-upload="${h(row.uploadId)}"`,blocked):''}${staff&&id(row.proofId)&&row.reviewStatus==='NOT_REVIEWED'?`<form data-form="proof-review" ${attrs} data-proof="${h(row.proofId)}"><label>Photo review<select name="decision"><option value="APPROVE">Suitable evidence for its stated purpose</option><option value="REJECT">Not suitable evidence</option></select></label><label>Review record reference<input name="reviewRef" maxlength="128" required></label><label class="check-label"><input name="reviewConfirmed" type="checkbox" required> I opened and reviewed this exact photo.</label><button class="button secondary" type="submit" ${blocked?'disabled':''}>Record photo review</button></form>`:''}</div>`).join('')||'<p class="small">No saved photos for this order.</p>'}`:''}`:''}${staff&&data.shippingTrackingEnabled?`<details><summary>Original shipment and tracking</summary>${parcelPlanner(order.orderId,ui,blocked)}${button('load-shipping','View shipment records',attrs,blocked)}${shipping?`${(ui.missingScanOrders?.[order.orderId]??[]).map(row=>`<p role="status">Carrier follow-up due: ${h(row.reason)} since ${h(date(row.dueAt))}. Review tracking and open an investigation when appropriate.</p>`).join('')}${shipments.map(row=>`<div class="case-panel"><p><strong>${h(row.direction)}</strong> · ${h(row.status)} · ${h(row.carrierStatusCode??'No carrier status')}</p><p class="small">Carrier acceptance: ${h(date(row.firstPossessionAt))}. Delivery: ${h(date(row.deliveredAt))}. Last checked: ${h(date(row.observedAt))}.</p>${row.attentionCode?`<p role="status">Review required: ${h(row.attentionCode)}</p>`:''}${id(row.shipmentKey)?button('sync-shipping','Check original carrier tracking',`${attrs} data-shipment="${h(row.shipmentKey)}"`,blocked):''}</div>`).join('')||'<p class="small">No issued shipment retained.</p>'}<div class="inline-actions">${['DISPATCH','DELIVER'].map(action=>button('carrier-milestone',action==='DISPATCH'?'Record carrier acceptance':'Record actual delivery',`${attrs} data-step="${action}"`,blocked)).join('')}</div>`:''}<form data-form="shipping-retain" ${attrs}><h4>Retain an already-issued shipment</h4><p class="small">Use its exact original ShipStation records and reviewed coverage. This action retrieves the shipment; it does not buy a label.</p><label>Direction<select name="direction"><option value="OUTBOUND">To the buyer</option><option value="RETURN">Approved return to ATLAS</option></select></label>${[['caseId','Approved return case ID (returns only)',false],['labelId','Original label ID',true],['shipmentId','Original shipment ID',true],['trackingNumber','Original tracking number',true],['externalShipmentId','Original external shipment ID (if present)',false],['issuanceEvidenceRef','Retained issuance evidence',true],['coverageEvidenceRef','Reviewed coverage evidence',true],['measurementRef','Sealed parcel measurement record',true]].map(([key,label,required])=>`<label>${label}<input name="${key}" maxlength="128" ${required?'required':''} ${blocked?'disabled':''}></label>`).join('')}<button class="button secondary" type="submit" ${blocked?'disabled':''}>Verify and retain original shipment</button></form></details>`:''}</article>`;
  }).join('')||'<p class="empty-state">Photos and shipment records become available with a paid order.</p>'}</section>`;
}

// The caller owns session teardown and the single mutation lock. An interrupted
// upload is recovered by its retained original ID; no second upload is automatic.
export function createPhysicalEvidenceController({getData,ui,apiPath,render,readState,requestId}) {
  const ownOrder=orderId=>(getData()?.orders??[]).some(row=>row.orderId===orderId);
  const staff=()=>getData()?.scope?.role==='STAFF';
  const token=()=>getData()?.csrfToken??'';
  const session=()=>JSON.stringify([getData()?.scope?.actorId,getData()?.scope?.role,token()]);
  let activeSession=null;
  const current=()=>{if(activeSession!==null&&session()!==activeSession)throw Object.assign(new Error('Your session changed. Refresh this workspace.'),{terminal:true});};
  async function get(path) {
    current();const response=await fetch(apiPath+path,{credentials:'same-origin',cache:'no-store'}),body=await response.json();
    current();if(!response.ok)throw Object.assign(new Error(body.error??'Saved evidence is unavailable.'),{terminal:response.status>=400&&response.status<500});return body;
  }
  async function post(path,input,binary=false) {
    current();const response=await fetch(apiPath+path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':binary?'application/octet-stream':'application/json','x-atlas-csrf':token()},body:binary?input:JSON.stringify(input)}),body=await response.json();
    current();if(!response.ok)throw Object.assign(new Error(body.error??'Evidence operation unavailable.'),{terminal:response.status>=400&&response.status<500});return body;
  }
  async function load(orderId,kind='proof') {
    const value=await get(kind==='proof'?`/proofs?orderId=${encodeURIComponent(orderId)}`:`/staff/shipping?orderId=${encodeURIComponent(orderId)}`);
    if(kind==='shipping'){const due=await get('/staff/shipping/missing-scans');(ui.missingScanOrders??={})[orderId]=Array.isArray(due)?due.filter(row=>row.orderId===orderId):[];}
    (kind==='proof'?(ui.proofOrders??={}):(ui.shippingOrders??={}))[orderId]=value;return value;
  }
  async function run(orderId,work,kind='proof') {
    if(ui.busy||ui.uncertain||!ownOrder(orderId))return;
    activeSession=session();ui.busy=true;ui.notice='Checking and retaining this order’s evidence…';render();
    try{await work();await readState();current();await load(orderId,kind);ui.notice='Saved evidence refreshed. Review its status before continuing.';}
    catch(error){ui.notice=error.message;ui.uncertain=!error.terminal;try{await readState();current();if(ownOrder(orderId))await load(orderId,kind);ui.notice=error.terminal?error.message:'The response was interrupted. Review the saved original; no upload or shipment was repeated.';}catch{ui.uncertain=true;}}
    finally{activeSession=null;ui.busy=false;render();}
  }
  async function submit(form) {
    const kind=form.dataset?.form;if(!['proof-upload','proof-review','shipping-retain','parcel-estimate'].includes(kind))return false;
    const orderId=form.dataset.order;if(!ownOrder(orderId)||getData()?.runtime==='LOCAL_DEMO')return true;
    const values=new FormData(form);
    if(kind==='parcel-estimate') {
      if(!staff()||ui.busy||ui.uncertain)return true;
      try{(ui.parcelEstimates??={})[orderId]=estimateParcelPreset({presetId:String(values.get('presetId')),weightOunces:Number(values.get('weightOunces'))});ui.notice='Packing comparison updated. Confirm the actual sealed parcel before label issuance.';}catch{ui.notice='Select a published box size and enter a positive comparison weight.';}render();return true;
    }
    if(kind==='proof-upload') {
      if(!getData()?.proofsEnabled)return true;
      const file=values.get('photo'),purpose=String(values.get('purpose')??''),limit=ui.proofOrders?.[orderId]?.limits?.maxObjectBytes;
      if(!file||!['image/png','image/jpeg'].includes(file.type)||!Number.isSafeInteger(file.size)||file.size<1||!Number.isSafeInteger(limit)||file.size>limit||!Object.hasOwn(labels,purpose)||!staff()&&purpose!=='RETURN_REQUEST') {ui.notice='Choose an original PNG or JPEG within the stated size limit.';render();return true;}
      await run(orderId,async()=>{
        const bytes=await file.arrayBuffer(),sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
        const key=`proof:${orderId}:${purpose}:${sha256}`;
        const original=await post('/proofs/prepare',{requestId:requestId(key),orderId,purpose,declaredType:file.type,byteCount:bytes.byteLength,sha256});
        if(original.status==='PREPARED'){if(!id(original.uploadId))throw new Error('Original upload reference is unavailable.');await post('/proofs/upload/'+original.uploadId,bytes,true);}
        else if(original.status!=='RETAINED')throw Object.assign(new Error('Check the saved original upload before continuing.'),{terminal:true});
      });
    } else if(kind==='proof-review') {
      if(!staff()||!values.has('reviewConfirmed'))return true;
      const proofId=form.dataset.proof,decision=String(values.get('decision')??''),reviewRef=String(values.get('reviewRef')??'').trim();
      if(!id(proofId)||!id(reviewRef)||!['APPROVE','REJECT'].includes(decision))return true;
      await run(orderId,()=>post('/proofs/review',{requestId:requestId(`proof-review:${proofId}:${decision}:${reviewRef}`),proofId,decision,reviewRef}));
    } else {
      if(!staff()||!getData()?.shippingTrackingEnabled)return true;
      const input=Object.fromEntries(['direction','caseId','labelId','shipmentId','trackingNumber','externalShipmentId','issuanceEvidenceRef','coverageEvidenceRef','measurementRef'].map(key=>[key,String(values.get(key)??'').trim()]));input.caseId=input.caseId||null;input.externalShipmentId=input.externalShipmentId||null;
      await run(orderId,()=>post('/staff/shipping/retain',{requestId:requestId('shipping:'+orderId+':'+JSON.stringify(input)),orderId,...input}),'shipping');
    }
    return true;
  }
  async function click(target) {
    const action=target.dataset?.action;if(!['load-proofs','recover-proof','use-return-proof','load-shipping','sync-shipping','carrier-milestone'].includes(action))return false;
    const orderId=target.dataset.order;if(!ownOrder(orderId)||getData()?.runtime==='LOCAL_DEMO')return true;
    if(action==='use-return-proof') {
      if(!ui.busy&&!ui.uncertain&&!staff()&&id(target.dataset.proof)){(ui.returnProofs??={})[orderId]=target.dataset.proof;ui.notice='Photo selected. Choose your return reason under Protection and review, then submit the request.';render();}return true;
    }
    const shipping=['load-shipping','sync-shipping','carrier-milestone'].includes(action);if(shipping&&!staff())return true;
    await run(orderId,async()=>{
      if(action==='recover-proof') {if(id(target.dataset.upload))await post('/proofs/recover',{uploadId:target.dataset.upload});}
      else if(action==='sync-shipping') {if(id(target.dataset.shipment))await post('/staff/shipping/sync',{shipmentKey:target.dataset.shipment});}
      else if(action==='carrier-milestone') {const step=target.dataset.step;if(['DISPATCH','DELIVER'].includes(step))await post('/staff/shipping/milestone',{requestId:requestId(`milestone:${orderId}:${step}`),orderId,action:step});}
    },shipping?'shipping':'proof');return true;
  }
  return Object.freeze({submit,click});
}
