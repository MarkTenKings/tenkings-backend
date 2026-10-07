import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHash } from 'node:crypto';
import { inspectSpeedsterPreparationSourceBytes, type SpeedsterPreparationStorage } from './speedsterPreparationStorage';
import { preparationRequire, SpeedsterPreparationConflict } from './speedsterPreparationIntegrity';

const MAX_BYTES = 50 * 1024 * 1024;
const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
const namespace = new RegExp(`^ai-grader-v2/(atlas-staff-${uuid})/(atlas-${uuid})/`);
const hash = /^[a-f0-9]{64}$/;
function check(condition: unknown, code = 'WORKSPACE_STORAGE_SCOPE_INVALID'): asserts condition { preparationRequire(condition, code); }
type Source = Readonly<{ sourceOwnerId: string; sourceId: string }>;
export type AtlasWorkspacePhotoDescriptor = Readonly<{ objectRef: string; sha256: string; byteCount: number;
    contentType: string; width?: number; height?: number; versionId?: string }>;
export type AtlasWorkspaceUpload = AtlasWorkspacePhotoDescriptor & Readonly<{ id: string; cardId: string; side: 'FRONT' | 'BACK';
    sourceId: string; sourceOwnerId: string }>;
export class AtlasWorkspaceUploadRejected extends Error {
    readonly cardId: string;
    readonly uploadId: string;
    constructor(upload: AtlasWorkspaceUpload, readonly reason: 'BYTES_MISMATCH' | 'INVALID_IMAGE') {
        super('WORKSPACE_UPLOAD_UNVERIFIED'); this.cardId = upload.cardId; this.uploadId = upload.id;
    }
}
// Only known data-validation failures from the original full-buffer decoder
// conclude that the photograph is invalid. Resource, runtime and unknown native
// failures remain uncertain, including any timeout or interrupted storage read.
export function isWorkspaceImageRejection(error: unknown) {
    if (!(error instanceof Error)) return false;
    if (/out of memory|allocat(?:ion|e).*fail|unable to allocate|ENOMEM|\bEIO\b|time(?:d? ?out)|abort|unavailable|not initialized|cannot load|module not found/i.test(error.message)) return false;
    if (error instanceof SpeedsterPreparationConflict) return [
        'Preparation requires a single-frame JPEG, PNG or WebP with valid EXIF orientation.',
        'This WebP has unsupported orientation metadata. Its photo is preserved; select the original JPEG or PNG before preparing.',
    ].includes(error.message);
    return /^(?:Input buffer contains unsupported image format|Input buffer has corrupt header|Input image exceeds pixel limit)(?:$|:)/.test(error.message)
        || /^(?:VipsJpeg: (?:Premature end of|premature end of|Corrupt JPEG data|Invalid JPEG file structure)|(?:pngload_buffer|webpload_buffer): (?:end of stream|unexpected end|invalid|Invalid|bad|Bad|truncated|Truncated))/.test(error.message);
}

function scopedKey(key: string, source?: Source) {
    const match = typeof key === 'string' && namespace.exec(key);
    check(match && (!source || match[1] === source.sourceOwnerId && match[2] === source.sourceId));
    const suffix = key.slice(match[0].length);
    check(new RegExp(`^(?:original/recapture-${uuid}/(?:front|back)\\.(?:jpg|png|webp)|source-evidence/[a-f0-9]{64}\\.(?:jpg|png|webp)|prepare-staging/(?:front|back)/${uuid}/(?:rectified|inspection|normalized|micro_defect|directional)\\.webp|prepared-evidence/(?:front|back)/${uuid}/(?:rectified|inspection|normalized|micro_defect|directional)-[a-f0-9]{64}\\.webp)$`).test(suffix));
    return suffix;
}
function descriptor(value: AtlasWorkspacePhotoDescriptor) {
    scopedKey(value.objectRef);
    check(hash.test(value.sha256) && Number.isSafeInteger(value.byteCount) && value.byteCount > 0 && value.byteCount <= MAX_BYTES
        && ['image/jpeg', 'image/png', 'image/webp'].includes(value.contentType)
        && (value.versionId === undefined || typeof value.versionId === 'string' && value.versionId.length > 0
            && value.versionId.length <= 256 && !/[\x00-\x1f\x7f]/.test(value.versionId)), 'WORKSPACE_UPLOAD_UNVERIFIED');
}

/** Private, injected S3 credentials only. Originals are exact checksum-bound
 * create-only objects; source/derived evidence remains in original preparation
 * namespaces. No public ACL, browser key, local disk, legacy key or arbitrary
 * object prefix is available through this adapter. */
export function createAtlasWorkspaceSourceStorage({ client, bucket, uploadOrigin, presign = getSignedUrl }: Readonly<{
    client: S3Client; bucket: string; uploadOrigin: string; presign?: typeof getSignedUrl;
}>) {
    let origin: URL; try { origin = new URL(uploadOrigin); } catch { throw new Error('WORKSPACE_STORAGE_CONFIGURATION_INVALID'); }
    check(origin.protocol === 'https:' && origin.origin === uploadOrigin && !origin.username && !origin.password
        && /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket), 'WORKSPACE_STORAGE_CONFIGURATION_INVALID');
    async function read(key: string, maximum = MAX_BYTES, signal?: AbortSignal, versionId?: string, selectedReference = false, expectedLength?: number) {
        if (!selectedReference) scopedKey(key); check(Number.isSafeInteger(maximum) && maximum > 0 && maximum <= MAX_BYTES);
        const controller = new AbortController(), abort = () => controller.abort(signal?.reason);
        signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
        let timer: ReturnType<typeof setTimeout>, stream: any, iterator: AsyncIterator<Uint8Array> | undefined;
        const deadline = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { controller.abort();
            reject(new Error('WORKSPACE_STORAGE_READ_TIMEOUT')); }, 15000); });
        const cancellation = new Promise<never>((_resolve, reject) => { controller.signal.addEventListener('abort', () => reject(new Error('WORKSPACE_STORAGE_READ_ABORTED')), { once: true });
            if (controller.signal.aborted) reject(new Error('WORKSPACE_STORAGE_READ_ABORTED')); });
        const within = <T>(promise: Promise<T>) => Promise.race([promise, deadline, cancellation]);
        let finished = false;
        try {
            const response = await within(client.send(new GetObjectCommand({ Bucket: bucket, Key: key, ...(versionId ? { VersionId: versionId } : {}) }), { abortSignal: controller.signal }));
            check(response.Body && Number.isSafeInteger(response.ContentLength) && response.ContentLength! > 0 && response.ContentLength! <= maximum, 'WORKSPACE_UPLOAD_UNVERIFIED');
            stream = response.Body; check(typeof stream[Symbol.asyncIterator] === 'function', 'WORKSPACE_STORAGE_READ_INVALID');
            if (expectedLength !== undefined) check(response.ContentLength === expectedLength && response.ContentRange === undefined,
                'WORKSPACE_UPLOAD_UNVERIFIED');
            iterator = stream[Symbol.asyncIterator](); const chunks: Buffer[] = []; let count = 0;
            while (true) {
                const next = await within(iterator!.next()); if (next.done) break;
                check(next.value instanceof Uint8Array, 'WORKSPACE_STORAGE_READ_INVALID'); count += next.value.byteLength;
                check(count <= maximum && count <= response.ContentLength!, 'WORKSPACE_UPLOAD_UNVERIFIED'); chunks.push(Buffer.from(next.value));
            }
            check(count === response.ContentLength, 'WORKSPACE_UPLOAD_UNVERIFIED'); finished = true; return Buffer.concat(chunks, count);
        } finally {
            clearTimeout(timer!); signal?.removeEventListener('abort', abort);
            if (!finished) {
                controller.abort(); try { stream?.destroy?.(); } catch { /* Preserve the read failure. */ }
                try { Promise.resolve(iterator?.return?.()).catch(() => {}); } catch { /* Never block on a failed stream. */ }
            }
        }
    }
    async function readExact(value: AtlasWorkspacePhotoDescriptor, signal?: AbortSignal) {
        descriptor(value); const bytes = await read(value.objectRef, value.byteCount, signal, value.versionId);
        check(bytes.length === value.byteCount && createHash('sha256').update(bytes).digest('hex') === value.sha256, 'WORKSPACE_UPLOAD_UNVERIFIED');
        return bytes;
    }
    async function signed(command: GetObjectCommand | PutObjectCommand, expiresIn: number, direct = false) {
        const url = await presign(client as unknown as Parameters<typeof getSignedUrl>[0], command as unknown as Parameters<typeof getSignedUrl>[1], { expiresIn,
            ...(direct ? { unhoistableHeaders: new Set(['x-amz-checksum-sha256', 'x-amz-acl']) } : {}) });
        const parsed = new URL(url); check(parsed.origin === uploadOrigin && !parsed.username && !parsed.password && !parsed.hash,
            'WORKSPACE_STORAGE_GRANT_INVALID'); return url;
    }
    return {
        async grant(upload: AtlasWorkspaceUpload, expiresAt: Date, now = new Date()) {
            descriptor(upload); scopedKey(upload.objectRef, upload);
            check(new RegExp(`^${uuid}$`).test(upload.id) && upload.sourceId === `atlas-${upload.cardId}`
                && upload.objectRef.includes(`/original/recapture-${upload.id}/${upload.side.toLowerCase()}.`));
            const seconds = Math.min(600, Math.floor((+expiresAt - +now) / 1000)); check(seconds > 0, 'WORKSPACE_UPLOAD_EXPIRED');
            const checksum = Buffer.from(upload.sha256, 'hex').toString('base64');
            const command = new PutObjectCommand({ Bucket: bucket, Key: upload.objectRef, ContentType: upload.contentType,
                ContentLength: upload.byteCount, ChecksumSHA256: checksum, ACL: 'private', IfNoneMatch: '*' });
            return { id: upload.id, url: await signed(command, seconds, true), method: 'PUT' as const,
                headers: { 'Content-Type': upload.contentType, 'x-amz-checksum-sha256': checksum, 'x-amz-acl': 'private', 'If-None-Match': '*' },
                expiresAt: new Date(+now + seconds * 1000).toISOString() };
        },
        async verify(upload: AtlasWorkspaceUpload) {
            descriptor(upload); scopedKey(upload.objectRef, upload);
            const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: upload.objectRef, ChecksumMode: 'ENABLED' }), { abortSignal: AbortSignal.timeout(15000) });
            check(Number.isSafeInteger(head.ContentLength) && head.ContentLength! > 0 && head.ContentLength! <= MAX_BYTES
                && head.ContentType === upload.contentType, 'WORKSPACE_UPLOAD_UNVERIFIED');
            const value = { ...upload, ...(head.VersionId ? { versionId: head.VersionId } : {}) };
            const bytes = await read(value.objectRef, Math.max(value.byteCount, head.ContentLength!), undefined, value.versionId, false, head.ContentLength!);
            if (bytes.length !== upload.byteCount || createHash('sha256').update(bytes).digest('hex') !== upload.sha256)
                throw new AtlasWorkspaceUploadRejected(upload, 'BYTES_MISMATCH');
            if (head.ChecksumSHA256 !== undefined) check(head.ChecksumSHA256 === Buffer.from(upload.sha256, 'hex').toString('base64'), 'WORKSPACE_UPLOAD_UNVERIFIED');
            let image: Awaited<ReturnType<typeof inspectSpeedsterPreparationSourceBytes>>;
            try { image = await inspectSpeedsterPreparationSourceBytes(bytes); }
            catch (error) { if (isWorkspaceImageRejection(error)) throw new AtlasWorkspaceUploadRejected(upload, 'INVALID_IMAGE'); throw error; }
            if (`image/${image.format}` !== upload.contentType) throw new AtlasWorkspaceUploadRejected(upload, 'INVALID_IMAGE');
            return { objectRef: upload.objectRef, sha256: upload.sha256, byteCount: upload.byteCount, contentType: upload.contentType,
                width: image.width, height: image.height, ...(head.VersionId ? { versionId: head.VersionId } : {}) };
        },
        readCapture: readExact,
        /** Only the private map adapter can supply an immutable, server-selected
         * revision reference. This does not extend original-photo API access. */
        mapReference(value: Readonly<{ storageKey: string; sha256: string }>) {
            const key = value.storageKey, expected = value.sha256;
            check(typeof key === 'string' && key.length <= 1024 && /^ai-grader-v2\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\//.test(key)
                && !/[\x00-\x20\x7f?#\\]/.test(key) && !key.split('/').some(part => !part || part === '.' || part === '..') && hash.test(expected), 'WORKSPACE_MAP_REFERENCE_INVALID');
            return { read: async () => { const bytes = await read(key, MAX_BYTES, undefined, undefined, true);
                check(createHash('sha256').update(bytes).digest('hex') === expected, 'WORKSPACE_MAP_REFERENCE_CHANGED'); return bytes; },
                readUrl: async () => signed(new GetObjectCommand({ Bucket: bucket, Key: key }), 300) };
        },
        forSource(source: Source) {
            const scopedRead: SpeedsterPreparationStorage['read'] = async (key, maximum) => { scopedKey(key, source); return read(key, maximum); };
            const create: SpeedsterPreparationStorage['create'] = async (key, bytes, contentType, checksumSha256) => {
                const suffix = scopedKey(key, source);
                check(suffix.startsWith('source-evidence/') || suffix.startsWith('prepared-evidence/'));
                check(bytes.length > 0 && bytes.length <= MAX_BYTES && hash.test(checksumSha256)
                    && createHash('sha256').update(bytes).digest('hex') === checksumSha256
                    && suffix.endsWith(`${checksumSha256}.${contentType === 'image/jpeg' ? 'jpg' : contentType.slice(6)}`), 'WORKSPACE_UPLOAD_UNVERIFIED');
                await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: bytes, ContentType: contentType,
                    ContentLength: bytes.length, ChecksumSHA256: Buffer.from(checksumSha256, 'hex').toString('base64'), ACL: 'private', IfNoneMatch: '*' }),
                { abortSignal: AbortSignal.timeout(15000) });
            };
            return { storage: { read: scopedRead, create },
                readUrl: async (key: string) => { scopedKey(key, source); return signed(new GetObjectCommand({ Bucket: bucket, Key: key }), 300); },
                stagingUpload: async (key: string) => { check(scopedKey(key, source).startsWith('prepare-staging/'));
                    return signed(new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: 'image/webp', ACL: 'private' }), 300); } };
        },
    };
}
