// U.S. is the displayed default. Explicit international prefixes are preserved.
// Normalize before identity, allowlist, rate-limit or request-replay checks.
export function phoneInput(value) {
    if (typeof value !== 'string' || value.length > 48 || !/^\s*\+?[\d ().-]+\s*$/.test(value)) return null;
    let phone = value.replace(/[\s().-]/g, '');
    if (/^\d{10}$/.test(phone)) phone = `+1${phone}`;
    else if (/^1\d{10}$/.test(phone)) phone = `+${phone}`;
    return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null;
}
