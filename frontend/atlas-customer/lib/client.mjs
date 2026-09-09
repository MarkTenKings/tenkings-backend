const ERROR_MESSAGES = {
    PLEASE_WAIT: 'Please wait before trying again. Requests are limited to protect your number.',
    USE_INTERNATIONAL_PHONE: 'Enter a 10-digit U.S. mobile number, or include + and the country code for another country.',
    CODE_NOT_ACCEPTED: 'That code was not accepted. Check the six digits, or request a new code after the wait period.',
    SIGN_IN_RESTART_REQUIRED: 'This verification could not be confirmed. Wait 11 minutes before requesting a new code. We will not resend automatically.',
    SIGN_IN_SESSION_EXPIRED: 'Your sign-in page expired. Refresh the page and start again.',
    SIGN_IN_REQUIRED: 'Your session has ended. Refresh the page to sign in again.',
    CSRF_REQUIRED: 'Your session changed. Refresh the page before continuing.',
    RETURN_DETAILS_REQUIRED: 'Complete your name and shipping/return address.',
    INVALID_SUBMISSION: 'Check the card details, return address and confirmation before submitting.',
    REQUEST_CONFLICT: 'This request was already used with different details. Refresh your dashboard to check the saved submission.',
    NOT_FOUND: 'This submission is not available in your account.',
    CUSTOMER_ACCESS_NOT_ENABLED: 'Customer sign-in is not open yet. Please try again later.',
    CUSTOMER_CONFIGURATION_REQUIRED: 'Customer sign-in is not open yet. Please try again later.',
};
export async function request(path, { body, csrf } = {}) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 25000);
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
                length += value.byteLength; if (length > 524288) throw Error('UNCONFIRMED_REPLY'); parts.push(value);
            }
        } finally { await reader.cancel().catch(() => {}); }
        const bytes = new Uint8Array(length); let offset = 0; for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
        const result = JSON.parse(new TextDecoder().decode(bytes));
        if (!response.ok) {
            const error = new Error(ERROR_MESSAGES[result.error] ?? 'We could not complete that request. Please try again later.'); error.code = result.error; throw error;
        }
        return result;
    } catch (error) {
        if (error.code) throw error;
        const failure = new Error('The reply could not be confirmed. Your current request is retained; try the same request again or refresh to check your account.');
        failure.code = 'UNCONFIRMED_REPLY'; throw failure;
    } finally { clearTimeout(timer); }
}
