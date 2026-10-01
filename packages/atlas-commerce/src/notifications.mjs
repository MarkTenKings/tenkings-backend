import { requireValue } from './contract.mjs';
import { progressMessage } from './progress-notifications.mjs';

/** One dispatch per durable outbox claim. Provider acceptance is not delivery. */
export function notificationAdapter({ emailApiKey,emailFrom,smsAccountSid,smsApiKeySid,smsApiKeySecret,smsServiceSid,fetchImpl=fetch,publicOrigin='https://atlasgrading.com' }) {
    requireValue(emailApiKey&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailFrom??'')&&/^AC[a-fA-F0-9]{32}$/.test(smsAccountSid??'')
        &&/^SK[a-fA-F0-9]{32}$/.test(smsApiKeySid??'')&&smsApiKeySecret&&/^MG[a-fA-F0-9]{32}$/.test(smsServiceSid??'')
        &&publicOrigin==='https://atlasgrading.com','RECEIPTS_NOT_CONFIGURED',503);
    return { async send(kind,receipt,effectId) {
        requireValue(['EMAIL_RECEIPT','SMS_RECEIPT','EMAIL_PROGRESS','SMS_PROGRESS'].includes(kind),'NOTIFICATION_KIND_INVALID');
        const progress=kind.endsWith('_PROGRESS')?progressMessage(receipt):null;
        const amount=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(receipt.totalCents/100);
        const text=progress?.text??`ATLAS Grading receipt ${receipt.reference??receipt.orderId}: payment of ${amount} confirmed. View your saved order at ${publicOrigin}/account. Physical arrival is tracked separately.`;
        if(kind==='EMAIL_RECEIPT'||kind==='EMAIL_PROGRESS') {
            requireValue(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(receipt.to??''),'RECEIPT_DESTINATION_INVALID');
            const response=await fetchImpl('https://api.sendgrid.com/v3/mail/send',{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
                headers:{Authorization:`Bearer ${emailApiKey}`,'Content-Type':'application/json'},body:JSON.stringify({
                    personalizations:[{to:[{email:receipt.to}],custom_args:{atlas_effect:effectId}}],from:{email:emailFrom,name:'ATLAS Grading'},
                    subject:progress?.subject??`Your ATLAS Grading receipt · ${receipt.reference??receipt.orderId}`,content:[{type:'text/plain',value:text}]})});
            requireValue(response.status===202&&response.headers.get('x-message-id'),'EMAIL_OUTCOME_UNKNOWN',503);
            return {provider:'SENDGRID',providerId:response.headers.get('x-message-id'),deliveryStatus:'ACCEPTED'};
        }
        requireValue(['SMS_RECEIPT','SMS_PROGRESS'].includes(kind)&&/^\+[1-9][0-9]{7,14}$/.test(receipt.to??''),'RECEIPT_DESTINATION_INVALID');
        const response=await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${smsAccountSid}/Messages.json`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),
            headers:{Authorization:`Basic ${Buffer.from(`${smsApiKeySid}:${smsApiKeySecret}`).toString('base64')}`,'Content-Type':'application/x-www-form-urlencoded'},
            body:new URLSearchParams({To:receipt.to,MessagingServiceSid:smsServiceSid,Body:text}).toString()});
        requireValue(response.ok,'SMS_OUTCOME_UNKNOWN',503);const result=await response.json();
        requireValue(/^SM[a-fA-F0-9]{32}$/.test(result.sid??'')&&result.account_sid===smsAccountSid,'SMS_OUTCOME_UNKNOWN',503);
        return {provider:'TWILIO',providerId:result.sid,deliveryStatus:String(result.status).toUpperCase()};
    }};
}
