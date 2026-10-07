import { createHash } from 'node:crypto';
import { BoundaryError } from '../policy.mjs';
import { MAX_PHOTO_BYTES, PHOTO_TYPES, WORKSPACE_SHA, requireWorkspace, verifiedWorkspaceUpload } from './workspace-intake-validation.mjs';

const unavailable = condition => requireWorkspace(condition, 503, 'WORKSPACE_STORAGE_UNAVAILABLE');
const exact = condition => requireWorkspace(condition, 409, 'WORKSPACE_UPLOAD_UNVERIFIED');

/** Bounded stream verification of an already planned exact original. This
 * retains no disk copy and never accepts ETag, metadata hashes or a caller URL.
 * read(signal) must address upload.objectRef itself and honor cancellation.
 * Both Node async iterables and Web ReadableStreams are supported. */
export async function readWorkspacePhotoBytes({ upload, read, timeoutMs = 15000 }) {
    exact(upload && Number.isSafeInteger(upload.byteCount) && upload.byteCount > 0 && upload.byteCount <= MAX_PHOTO_BYTES
        && WORKSPACE_SHA.test(upload.sha256 ?? '') && PHOTO_TYPES.includes(upload.contentType));
    unavailable(typeof read === 'function' && Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 60000);
    const controller = new AbortController();
    let timedOut = false, reader, iterator, stream, deadline;
    const timeout = new Promise((resolve, reject) => {
        deadline = setTimeout(() => {
            timedOut = true; controller.abort();
            reject(new BoundaryError(503, 'WORKSPACE_STORAGE_UNAVAILABLE'));
        }, timeoutMs);
    });
    const within = promise => Promise.race([promise, timeout]);
    const chunks = [], digest = createHash('sha256');
    let size = 0, completed = false;
    const consume = chunk => {
        exact(Buffer.isBuffer(chunk) || chunk instanceof Uint8Array);
        size += chunk.byteLength;
        exact(Number.isSafeInteger(size) && size <= upload.byteCount && size <= MAX_PHOTO_BYTES);
        // Copy reusable stream buffers, preserving the bytes actually hashed.
        const copy = Buffer.from(chunk); chunks.push(copy); digest.update(copy);
    };
    try {
        stream = await within(Promise.resolve().then(() => read(controller.signal)));
        unavailable(!timedOut && !controller.signal.aborted);
        if (Buffer.isBuffer(stream) || stream instanceof Uint8Array) consume(stream);
        else if (typeof stream?.getReader === 'function') {
            reader = stream.getReader();
            while (true) {
                const next = await within(reader.read()); unavailable(!timedOut);
                if (next.done) break;
                consume(next.value);
            }
        } else {
            unavailable(typeof stream?.[Symbol.asyncIterator] === 'function');
            iterator = stream[Symbol.asyncIterator]();
            while (true) {
                const next = await within(iterator.next()); unavailable(!timedOut);
                if (next.done) break;
                consume(next.value);
            }
        }
        unavailable(!timedOut);
        exact(size === upload.byteCount && digest.digest('hex') === upload.sha256);
        completed = true;
        return Buffer.concat(chunks, size);
    } finally {
        clearTimeout(deadline);
        if (!completed) {
            controller.abort();
            // Cleanup must not wait forever on the stream that just timed out.
            if (reader) { try { Promise.resolve(reader.cancel()).catch(() => {}); } catch { /* Keep the original failure. */ } }
            if (iterator?.return) { try { Promise.resolve(iterator.return()).catch(() => {}); } catch { /* Keep the original failure. */ } }
            try { stream?.destroy?.(); } catch { /* Keep the original failure. */ }
        }
        try { reader?.releaseLock(); } catch { /* A cancelled read may still be settling. */ }
    }
}

/** Small adapter for a trusted storage/decoder implementation. HEAD checks
 * identity/size/type; the same exact object is always streamed and hashed before
 * the decoder inspects its pixels. A valid provider-native checksum is checked
 * if present, but never replaces the bounded read needed for decoding. inspect
 * must fully decode one still image and return {contentType,width,height}.
 * Preparation, geometry and grading stay outside this transport verifier. */
export function workspacePhotoVerifier({ head, read, inspect }) {
    unavailable(typeof head === 'function' && typeof read === 'function' && typeof inspect === 'function');
    return async ({ upload, source }) => {
        const metadata = await head({ upload, source });
        exact(metadata?.objectRef === upload.objectRef && metadata.byteCount === upload.byteCount
            && metadata.contentType === upload.contentType);
        if (metadata.nativeChecksumPresent === true) exact(WORKSPACE_SHA.test(metadata.sha256 ?? '') && metadata.sha256 === upload.sha256);
        const bytes = await readWorkspacePhotoBytes({ upload, read: signal => read({ upload, source, metadata, signal }) });
        const dimensions = await inspect(bytes);
        exact(dimensions && dimensions.contentType === upload.contentType);
        const result = { objectRef: upload.objectRef, sha256: upload.sha256, byteCount: upload.byteCount,
            contentType: upload.contentType, width: dimensions.width, height: dimensions.height };
        if (metadata.versionId !== undefined) result.versionId = metadata.versionId;
        return verifiedWorkspaceUpload(result, upload);
    };
}
