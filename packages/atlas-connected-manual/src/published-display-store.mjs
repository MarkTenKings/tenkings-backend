import {randomUUID} from 'node:crypto';
import {digest,requireThat} from '@atlas/manual-service/contract';
import {DISPLAY_JOB_POLICY} from './review-display-store.mjs';
const eligible=`p.state='PUBLISHED' AND p.manifest_hash=j.manifest_hash AND p.manifest=j.manifest AND p.mode=j.mode
 AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d WHERE d.card_id=j.card_id)`;
const join=`JOIN atlas_manual.publication p ON p.card_id=j.card_id AND p.action_id=j.action_id`;
const parse=row=>{if(!row)return null;
 requireThat(digest(row.manifest)===row.manifest_hash&&(!row.result||digest(row.result)===row.result_hash),503,'DISPLAY_STORED_CONTENT_INVALID');
 return {...row,publication:JSON.parse(row.manifest),result:row.result?JSON.parse(row.result):null};};
// Called only inside the owning display store's deployment-authenticated short
// transaction. Published authority never becomes an intake/browser principal.
export const publishedDisplayStore=Object.freeze({
 async discover(tx,limit,mode){return tx.$executeRawUnsafe(`INSERT INTO atlas_manual_connected.published_review_display
   (card_id,action_id,side,mode,manifest,manifest_hash,policy)
   SELECT p.card_id,p.action_id,s.side,p.mode,p.manifest,p.manifest_hash,$1
   FROM atlas_manual.publication p CROSS JOIN (VALUES('FRONT'),('BACK')) s(side)
   WHERE p.state='PUBLISHED' AND p.mode=$2
    AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d WHERE d.card_id=p.card_id)
    AND NOT EXISTS(SELECT 1 FROM atlas_manual_connected.published_review_display j
      WHERE j.card_id=p.card_id AND j.action_id=p.action_id AND j.side=s.side AND j.policy=$1)
   ORDER BY p.published_at DESC,p.card_id,s.side LIMIT $3 ON CONFLICT DO NOTHING`,DISPLAY_JOB_POLICY,mode,limit);},
 async claim(tx,mode,before=null){
  const [job]=await tx.$queryRawUnsafe(`SELECT j.* FROM atlas_manual_connected.published_review_display j ${join}
    WHERE j.policy=$1 AND j.mode=$2 AND ($3::timestamptz IS NULL OR j.available_at<=$3::timestamptz) AND ${eligible} AND (j.state='QUEUED' AND j.available_at<=clock_timestamp()
      OR j.state='RUNNING' AND j.lease_until<=clock_timestamp())
    ORDER BY j.available_at,j.card_id,j.side LIMIT 1 FOR UPDATE OF j SKIP LOCKED`,DISPLAY_JOB_POLICY,mode,before);
  if(!job)return null;
  return parse((await tx.$queryRawUnsafe(`UPDATE atlas_manual_connected.published_review_display SET state='RUNNING',claim_id=$2::uuid,
    lease_until=clock_timestamp()+interval '120 seconds',attempts=attempts+1,updated_at=clock_timestamp() WHERE id=$1::uuid RETURNING *`,job.id,randomUUID()))[0]);
 },
 async renew(tx,job){return(await tx.$executeRawUnsafe(`UPDATE atlas_manual_connected.published_review_display j
   SET lease_until=clock_timestamp()+interval '120 seconds',updated_at=clock_timestamp()
   WHERE j.id=$1::uuid AND j.claim_id=$2::uuid AND j.state='RUNNING' AND j.lease_until>clock_timestamp()
    AND EXISTS(SELECT 1 FROM atlas_manual.publication p WHERE p.card_id=j.card_id AND p.action_id=j.action_id AND ${eligible})`,job.id,job.claim_id))===1;},
 async finish(tx,job,{text,sourceImageSha256,code,retry}){
  // Publication is immutable; the intake SHARE lock only serializes a possible
  // discard tombstone. There is deliberately no selected-upload/access fence.
  await tx.$queryRawUnsafe('SELECT id FROM atlas_manual_intake.card WHERE id=$1::uuid FOR SHARE',job.card_id);
  const [current]=await tx.$queryRawUnsafe(`SELECT j.id FROM atlas_manual_connected.published_review_display j ${join}
    WHERE j.id=$1::uuid AND j.claim_id=$2::uuid AND j.state='RUNNING' AND j.lease_until>clock_timestamp() AND ${eligible} FOR UPDATE OF j`,job.id,job.claim_id);
  if(!current){await tx.$executeRawUnsafe(`UPDATE atlas_manual_connected.published_review_display j SET state='SUPERSEDED',code='DISPLAY_PUBLICATION_CHANGED',
    claim_id=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE id=$1::uuid AND claim_id=$2::uuid AND state='RUNNING' AND NOT EXISTS(SELECT 1 FROM atlas_manual.publication p
      WHERE p.card_id=j.card_id AND p.action_id=j.action_id AND ${eligible})`,job.id,job.claim_id);return false;}
  await tx.$executeRawUnsafe(`UPDATE atlas_manual_connected.published_review_display SET state=$3,result=$4,result_hash=$5,
    source_image_hash=$6,code=$7,claim_id=NULL,lease_until=NULL,available_at=clock_timestamp()+$8*interval '1 millisecond',updated_at=clock_timestamp()
    WHERE id=$1::uuid AND claim_id=$2::uuid`,job.id,job.claim_id,text?'READY':retry?'QUEUED':'FAILED',text,text?digest(text):null,
  sourceImageSha256,code,retry?Math.min(60000,1000*2**Math.min(job.attempts,6)):0);return true;
 },
 async inspection(tx,imageHash,frameHash){return parse((await tx.$queryRawUnsafe(`SELECT j.* FROM atlas_manual_connected.published_review_display j ${join}
   WHERE j.source_image_hash=$1 AND j.policy=$2 AND j.state='READY' AND ${eligible}
    AND j.result::jsonb->'descriptor'->>'frameDescriptorSha256'=$3 LIMIT 1`,imageHash,DISPLAY_JOB_POLICY,frameHash))[0]);},
});
