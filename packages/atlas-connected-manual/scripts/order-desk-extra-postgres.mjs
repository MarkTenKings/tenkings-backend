// Called only by the owned disposable qualification after preservation census.
// Synthetic PDF bytes; no provider dispatch, production URL or credentials.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
const sha=value=>createHash('sha256').update(value).digest('hex');
export async function qualifyOrderDeskLabels({fixture,desk,staff,orderId}) {
  const bytes=Buffer.from('%PDF-1.7\nOwned synthetic order-desk label fixture\n%%EOF');
  const [hash]=await fixture.admin.$queryRawUnsafe("SELECT atlas_customer.commerce_hash('{}'::jsonb) AS value");
  const label={id:`${orderId}:fedex:INBOUND:v1`,orderId,kind:'FEDEX_LABEL',state:'SUCCEEDED',request:{orderId,leg:'INBOUND',shipment:{}},
    claimId:randomUUID(),result:{provider:'FEDEX',requestHash:hash.value,mimeType:'application/pdf',labelBase64:bytes.toString('base64'),labelSha256:sha(bytes),trackingNumber:'SYNTHETIC-TRACKING'}};
  const valid=async value=>(await fixture.admin.$queryRawUnsafe('SELECT atlas_dealer.order_desk_label_valid(jsonb_populate_record(NULL::atlas_customer."CommerceEffect",$1::jsonb)) AS value',JSON.stringify(value)))[0].value;
  assert.equal(await valid(label),true);
  for(const changed of [{id:`${randomUUID()}:fedex:INBOUND:v1`},{state:'PENDING'},{request:{...label.request,orderId:randomUUID()}},{request:{...label.request,leg:'RETURN'}},
    {result:{...label.result,provider:'SHIPSTATION'}},{result:{...label.result,requestHash:'0'.repeat(64)}},{result:{...label.result,mimeType:'text/html'}},
    {result:{...label.result,labelSha256:'0'.repeat(64)}},{result:{...label.result,labelBase64:Buffer.from('not a PDF').toString('base64')}},
    {result:{...label.result,labelBase64:label.result.labelBase64+'\n'}}])assert.equal(await valid({...label,...changed}),false);
  await fixture.admin.$executeRawUnsafe(`INSERT INTO atlas_customer."CommerceEffect"(id,"orderId",kind,state,request,"claimId",result)
    VALUES($1,$2::uuid,$3,$4,$5::jsonb,$6::uuid,$7::jsonb)`,label.id,orderId,label.kind,label.state,JSON.stringify(label.request),label.claimId,JSON.stringify(label.result));
  const result=await desk.label(staff,{orderId,leg:'INBOUND'});assert.deepEqual(result.bytes,bytes);assert.equal(result.sha256,sha(bytes));assert.equal(result.contentType,'application/pdf');
  const detail=await desk.detail(staff,{orderId});assert.equal(detail.order.shipping.inbound.artifactState,'READY');assert.equal(detail.order.shipping.inbound.trackingNumber,'SYNTHETIC-TRACKING');
  assert.equal(detail.order.shipping.inbound.labelUrl,`/api/staff/manual-connected/order-desk/orders/${orderId}/labels/INBOUND`);
  assert.equal(detail.order.shipping.return.artifactState,'PENDING');assert.equal(detail.order.shipping.return.labelUrl,null);
  return ['actual PostgreSQL label validator rejects corrupt PDF/hash/provider/request/order/leg/base64 and pending state; staff inbound reads exact synthetic PDF bytes; READY and download URL require validated artifact; return remains pending'];
}
