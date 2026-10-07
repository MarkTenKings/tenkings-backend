export const GRADING_STREAM_HEADER = 'x-atlas-grading-stream';
export const GRADING_STREAM_PROTOCOL = 'atlas-grading-result-v1';
export const isGradingRequest = (path, body) => body !== undefined && /^cards\/[^/?#]+\/grade$/.test(path);

// Whitespace is transport liveness only. A complete, versioned terminal result
// supplies the real status after the HTTP headers have already been committed.
export function gradingResponseResult(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).length !== 3 || !['protocol', 'status', 'body'].every(key => Object.hasOwn(value, key))
        || value.protocol !== GRADING_STREAM_PROTOCOL || !Number.isInteger(value.status)
        || !(value.status === 200 || value.status >= 400 && value.status <= 599)
        || !value.body || typeof value.body !== 'object' || Array.isArray(value.body)
        || (value.status === 200 ? Object.hasOwn(value.body, 'error')
            : typeof value.body.error !== 'string' || !/^[A-Z][A-Z0-9_]{0,99}$/.test(value.body.error)))
        throw new Error('INVALID_GRADING_RESPONSE');
    return { data: value.body, ok: value.status === 200, status: value.status };
}
