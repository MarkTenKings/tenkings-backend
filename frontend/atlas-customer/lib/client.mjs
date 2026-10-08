const ERROR_MESSAGES = {
    PROFILE_EMAIL_REQUIRED: 'Add a valid email for your receipt and submission updates.',
    EMAIL_VERIFICATION_REQUIRED: 'Verify your receipt email before continuing to payment.',
    EMAIL_VERIFICATION_NOT_CONFIGURED: 'Email verification is not available yet. Your submission remains saved.',
    EMAIL_VERIFICATION_WAIT: 'Please wait before requesting another email or confirming again.',
    EMAIL_LINK_INVALID: 'This email link expired or was replaced. Request a fresh link from your saved submission.',
    EMAIL_LINK_CHANGED: 'The email for this submission changed. Request a fresh link for the saved address.',
    PLEASE_WAIT: 'Please wait before trying again. Requests are limited to protect your number.',
    USE_INTERNATIONAL_PHONE: 'Enter a 10-digit U.S. mobile number, or include + and the country code for another country.',
    CODE_NOT_ACCEPTED: 'That code was not accepted. Check the six digits, or request a new code after the wait period.',
    SIGN_IN_RESTART_REQUIRED: 'This verification could not be confirmed. Wait 11 minutes before requesting a new code. We will not resend automatically.',
    SIGN_IN_SESSION_EXPIRED: 'Your sign-in page expired. Refresh the page and start again.',
    SIGN_IN_REQUIRED: 'Your session has ended. Refresh the page to sign in again.',
    CSRF_REQUIRED: 'Your session changed. Refresh the page before continuing.',
    CONTACT_DETAILS_REQUIRED: 'Enter your name and a valid email address.',
    RETURN_DETAILS_REQUIRED: 'Complete your name, email and shipping/return address.',
    INTAKE_CONFIGURATION_REQUIRED: 'Photo uploads are not available yet. Your saved photos remain on this device.',
    KIOSK_NOT_AVAILABLE: 'This kiosk is not accepting submissions. Choose another enabled location.',
    INTAKE_REVISION_CHANGED: 'Your card details changed. Review the latest saved list and continue again.',
    INTAKE_REVIEW_NOT_READY: 'Wait for all photos to upload and check any missing card details.',
    INTAKE_ALREADY_ORDERED: 'This card list is attached to a payment or order and cannot be edited.',
    DISTINCT_CARD_SIDES_REQUIRED: 'Choose different front and back photos of the same card.',
    INTAKE_CARD_LIMIT: 'This submission already has 100 cards. Start another submission for more cards.',
    INVALID_SUBMISSION: 'Check the card details, return address and confirmation before submitting.',
    REQUEST_CONFLICT: 'This request was already used with different details. Refresh your dashboard to check the saved submission.',
    NOT_FOUND: 'This submission is not available in your account.',
    CUSTOMER_ACCESS_NOT_ENABLED: 'Customer sign-in is not open yet. Please try again later.',
    CUSTOMER_CONFIGURATION_REQUIRED: 'Customer sign-in is not open yet. Please try again later.',
};
export async function request(path, { body, csrf } = {}) {
    // The private service may spend 95s verifying an original or reconciling a
    // provider result; its 110s API deadline must expire before the browser's.
    // Ordinary account/auth reads keep their shorter responsiveness bound.
    const longOperation = path === '/email/request' || /^\/intake\/drafts\/[a-f0-9-]{36}\/cards\/[a-f0-9-]{36}\/uploads\/[a-f0-9-]{36}\/(?:sign|complete)$/.test(path)
        || /^\/commerce\/(?:checkout(?:\?draftId=[a-f0-9-]{36})?|quotes|payments(?:\/[a-f0-9-]{36}\/reconcile)?)$/.test(path)
        || /^\/commerce\/orders\/[a-f0-9-]{36}\/shipping(?:\/(?:quotes|payments|payments\/[a-f0-9-]{36}\/reconcile))?$/.test(path);
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), longOperation ? 115000 : 25000);
    // A private saved PDF may be up to 4 MiB; base64 JSON needs a larger read
    // bound. Keep ordinary account/auth/intake responses at their existing cap.
    const responseLimit = body === undefined && /^\/commerce\/orders\/[a-f0-9-]{36}\/labels\/[^/?#]{1,450}$/.test(path)
        ? 6 * 1024 * 1024 : 524288;
    try {
        const response = await fetch(`/account/api/customer${path}`, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin',
            cache: 'no-store', redirect: 'error', signal: controller.signal,
            headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Atlas-Customer-Csrf': csrf ?? '' },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        if (!response.body || !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '')) throw Error('UNCONFIRMED_REPLY');
        const reader = response.body.getReader(), parts = []; let length = 0;
        try {
            while (true) {
                const { value, done } = await reader.read(); if (done) break;
                length += value.byteLength; if (length > responseLimit) throw Error('UNCONFIRMED_REPLY'); parts.push(value);
            }
        } finally { await reader.cancel().catch(() => {}); }
        const bytes = new Uint8Array(length); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
        const result = JSON.parse(new TextDecoder().decode(bytes));
        if (!response.ok) {
            const error = new Error(ERROR_MESSAGES[result.error] ?? 'We could not complete that request. Please try again later.'); error.code = result.error; error.status = response.status; throw error;
        }
        return result;
    } catch (error) {
        if (error.code) throw error;
        const failure = new Error('The reply could not be confirmed. Your current request is retained; try the same request again or refresh to check your account.');
        failure.code = 'UNCONFIRMED_REPLY'; throw failure;
    } finally { clearTimeout(timer); }
}
