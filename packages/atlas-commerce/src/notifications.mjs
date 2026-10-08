import { requireValue } from './contract.mjs';
import { progressMessage } from './progress-notifications.mjs';

const emailAddress = value => typeof value === 'string' && value.length <= 254
    && !/[\x00-\x1f\x7f]/.test(value) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
function message(kind, receipt, publicOrigin) {
    if(kind==='EMAIL_SHIPPING_RECEIPT')return {subject:`Your ATLAS shipping payment receipt · ${receipt.reference ?? receipt.orderId}`,text:`Shipping payment of ${new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(receipt.totalCents/100)} confirmed for ATLAS order ${receipt.reference ?? receipt.orderId}. Your grading payment remains separate. View both saved receipts at ${publicOrigin}/account. Your inbound label will appear there after it is prepared; we will email you when it is ready to print. Physical arrival is tracked separately.`};
    if(kind==='EMAIL_LABEL_READY')return {subject:`Your ATLAS shipping label is ready · ${receipt.reference ?? receipt.orderId}`,text:`Your inbound shipping label is ready to print. Sign in at ${publicOrigin}/account, open your saved order, and download the label. Use the packaging and service shown on your shipping receipt. Physical arrival is tracked separately.`};
    const progress = kind.endsWith('_PROGRESS') ? progressMessage(receipt) : null;
    const amount = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(receipt.totalCents / 100);
    return { subject: progress?.subject ?? `Your ATLAS Grading receipt · ${receipt.reference ?? receipt.orderId}`,
        text: progress?.text ?? `ATLAS Grading receipt ${receipt.reference ?? receipt.orderId}: payment of ${amount} confirmed. View your saved order at ${publicOrigin}/account. ${receipt.shippingPayment==='SEPARATE_PAYMENT' ? 'This payment covers grading and its applicable tax. Shipping is not quoted or paid. Return to your saved order to review and pay for shipping when available. ' : ''}Physical arrival is tracked separately.` };
}

/** Available before paid commerce opens. Acceptance is not confirmed delivery. */
export function sendGridEmailAdapter({ emailApiKey, emailFrom, fetchImpl = fetch, publicOrigin = 'https://atlasgrading.com' }) {
    requireValue(emailApiKey && emailAddress(emailFrom) && publicOrigin === 'https://atlasgrading.com', 'RECEIPTS_NOT_CONFIGURED', 503);
    async function sendEmail(to, subject, content, effectId, verification = false) {
        requireValue(emailAddress(to), 'RECEIPT_DESTINATION_INVALID');
        requireValue(typeof effectId === 'string' && /^[A-Za-z0-9:_-]{1,180}$/.test(effectId), 'NOTIFICATION_ID_INVALID');
        const response = await fetchImpl('https://api.sendgrid.com/v3/mail/send', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
            headers: { Authorization: `Bearer ${emailApiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ personalizations: [{ to: [{ email: to }], custom_args: { atlas_effect: effectId } }],
                from: { email: emailFrom, name: 'ATLAS Grading' }, subject, content,
                ...(verification ? { tracking_settings: { click_tracking: { enable: false, enable_text: false }, open_tracking: { enable: false } } } : {}) }) });
        requireValue(response.status === 202 && response.headers.get('x-message-id'), 'EMAIL_OUTCOME_UNKNOWN', 503);
        return { provider: 'SENDGRID', providerId: response.headers.get('x-message-id'), deliveryStatus: 'ACCEPTED' };
    }
    return {
        async send(kind, receipt, effectId) {
            requireValue(['EMAIL_RECEIPT', 'EMAIL_SHIPPING_RECEIPT', 'EMAIL_LABEL_READY', 'EMAIL_PROGRESS'].includes(kind), 'NOTIFICATION_KIND_INVALID');
            const value = message(kind, receipt, publicOrigin);
            return sendEmail(receipt.to, value.subject, [{ type: 'text/plain', value: value.text }], effectId);
        },
        async sendVerification({ to, verificationUrl }, effectId) {
            let url;
            try { url = new URL(verificationUrl); } catch { requireValue(false, 'EMAIL_VERIFICATION_LINK_INVALID'); }
            requireValue(typeof verificationUrl === 'string' && url.href === verificationUrl
                && url.origin === publicOrigin && url.pathname === '/account/verify-email' && !url.search
                && !url.username && !url.password && !url.port && /^#token=[A-Za-z0-9_-]{43}$/.test(url.hash), 'EMAIL_VERIFICATION_LINK_INVALID');
            const text = `Verify your email for your ATLAS submission: ${verificationUrl}\n\nYour cards and details are saved. This link verifies your email address; it does not sign you in. If you did not request this email, you can ignore it.`;
            const html = `<p>Verify your email for your ATLAS submission.</p><p><a href="${verificationUrl}" style="display:inline-block;padding:14px 22px;background:#171b19;color:#ffffff;text-decoration:none;border-radius:6px">Verify email</a></p><p>Your cards and details are saved. This link verifies your email address; it does not sign you in.</p><p>If you did not request this email, you can ignore it.</p>`;
            return sendEmail(to, 'Verify your ATLAS email', [{ type: 'text/plain', value: text }, { type: 'text/html', value: html }], effectId, true);
        },
    };
}

/** One dispatch per durable outbox claim. Provider acceptance is not delivery. */
export function notificationAdapter({ emailApiKey, emailFrom, smsAccountSid, smsApiKeySid, smsApiKeySecret, smsServiceSid,
    smsEnabled = true, fetchImpl = fetch, publicOrigin = 'https://atlasgrading.com' }) {
    const email = sendGridEmailAdapter({ emailApiKey, emailFrom, fetchImpl, publicOrigin });
    requireValue(typeof smsEnabled === 'boolean' && (!smsEnabled || (/^AC[a-fA-F0-9]{32}$/.test(smsAccountSid ?? '')
        && /^SK[a-fA-F0-9]{32}$/.test(smsApiKeySid ?? '') && smsApiKeySecret && /^MG[a-fA-F0-9]{32}$/.test(smsServiceSid ?? ''))), 'RECEIPTS_NOT_CONFIGURED', 503);
    return {
        canSend: kind => ['EMAIL_RECEIPT', 'EMAIL_SHIPPING_RECEIPT', 'EMAIL_LABEL_READY', 'EMAIL_PROGRESS'].includes(kind) || smsEnabled && ['SMS_RECEIPT', 'SMS_PROGRESS'].includes(kind),
        async send(kind, receipt, effectId) {
            requireValue(['EMAIL_RECEIPT', 'EMAIL_SHIPPING_RECEIPT', 'EMAIL_LABEL_READY', 'SMS_RECEIPT', 'EMAIL_PROGRESS', 'SMS_PROGRESS'].includes(kind), 'NOTIFICATION_KIND_INVALID');
            if (kind.startsWith('EMAIL_')) return email.send(kind, receipt, effectId);
            requireValue(smsEnabled, 'SMS_NOTIFICATIONS_DISABLED', 503);
            requireValue(/^\+[1-9][0-9]{7,14}$/.test(receipt.to ?? ''), 'RECEIPT_DESTINATION_INVALID');
            const text = message(kind, receipt, publicOrigin).text;
            const response = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${smsAccountSid}/Messages.json`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
                headers: { Authorization: `Basic ${Buffer.from(`${smsApiKeySid}:${smsApiKeySecret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ To: receipt.to, MessagingServiceSid: smsServiceSid, Body: `${text} Reply STOP to unsubscribe.` }).toString() });
            requireValue(response.ok, 'SMS_OUTCOME_UNKNOWN', 503); const result = await response.json();
            requireValue(/^SM[a-fA-F0-9]{32}$/.test(result.sid ?? '') && result.account_sid === smsAccountSid, 'SMS_OUTCOME_UNKNOWN', 503);
            return { provider: 'TWILIO', providerId: result.sid, deliveryStatus: String(result.status).toUpperCase() };
        },
    };
}
