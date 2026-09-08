import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { PrismaClient } from '@prisma/client';
import { ApprovedPublicMedia } from '@atlas/service-bridge/public-media';
import { bridgeOrigin, canonical, digest, keyBytes, requireBridge } from '@atlas/service-bridge/protocol';
import { readStorageBufferBounded } from './storage';

export function atlasPublicMediaConfig(env: NodeJS.ProcessEnv = process.env) {
    requireBridge(env.NODE_ENV === 'production' && env.VERCEL_ENV === 'production' && env.ATLAS_PUBLIC_MEDIA_RUNTIME === 's3'
        && !Object.keys(env).some(k => k.startsWith('ATLAS_LOCAL_')) && /^[a-z0-9-]+\.vercel\.app$/.test(env.VERCEL_URL ?? '')
        && /^[a-f0-9]{40}$/.test(env.VERCEL_GIT_COMMIT_SHA ?? ''), 'PUBLIC_MEDIA_NOT_ENABLED');
    const origin = bridgeOrigin(env.ATLAS_PUBLIC_MEDIA_ORIGIN), key = keyBytes(env.ATLAS_PUBLIC_MEDIA_KEY);
    const endpoint = bridgeOrigin(env.ATLAS_PUBLIC_MEDIA_STORAGE_ENDPOINT);
    const bucket = env.ATLAS_PUBLIC_MEDIA_STORAGE_BUCKET, region = env.ATLAS_PUBLIC_MEDIA_STORAGE_REGION;
    const accessKeyId = env.ATLAS_PUBLIC_MEDIA_STORAGE_ACCESS_KEY_ID, secretAccessKey = env.ATLAS_PUBLIC_MEDIA_STORAGE_SECRET_ACCESS_KEY;
    requireBridge(typeof bucket === 'string' && /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)
        && typeof region === 'string' && /^[a-z0-9-]{1,64}$/.test(region)
        && typeof accessKeyId === 'string' && accessKeyId.length >= 16 && accessKeyId.length <= 128
        && typeof secretAccessKey === 'string' && secretAccessKey.length >= 32 && secretAccessKey.length <= 256,
    'PUBLIC_MEDIA_CONFIGURATION_INVALID');
    const fixed = { mode: 'PRODUCTION', origin, deploymentId: env.VERCEL_URL!, releaseSha: env.VERCEL_GIT_COMMIT_SHA!,
        clientKeyHash: digest(key), endpoint, bucket, region };
    const configHash = digest(canonical({ version: 'atlas-public-media-config-v1', ...fixed,
        accessKeyHash: digest(accessKeyId), secretKeyHash: digest(secretAccessKey) }));
    return { ...fixed, configHash, key, accessKeyId, secretAccessKey };
}
export function createAtlasPublicMedia(client: PrismaClient, config: ReturnType<typeof atlasPublicMediaConfig>) {
    // Dedicated read-only credentials. No ambient SDK credential chain or
    // legacy storage/client fallback. Only GetObject is reachable here.
    const storage = new S3Client({ endpoint: config.endpoint, region: config.region, forcePathStyle: true, maxAttempts: 1,
        credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } });
    return new ApprovedPublicMedia({ client, config, async readStorage(sourceRef, limit) {
        const signal = AbortSignal.timeout(25_000);
        let abortBody: (() => void) | undefined;
        try {
            return await readStorageBufferBounded(sourceRef, limit, {
                async openRead(storageKey: string) {
                    const response = await storage.send(new GetObjectCommand({ Bucket: config.bucket, Key: storageKey }), { abortSignal: signal });
                    const body = response.Body as unknown as AsyncIterable<Uint8Array> & { destroy: (error?: Error) => void };
                    requireBridge(body && typeof body[Symbol.asyncIterator] === 'function' && typeof body.destroy === 'function', 'PUBLIC_IMAGE_BODY_INVALID');
                    abortBody = () => body.destroy(new Error('PUBLIC_IMAGE_READ_TIMEOUT'));
                    signal.addEventListener('abort', abortBody, { once: true });
                    if (signal.aborted) { abortBody(); signal.throwIfAborted(); }
                    return { storageKey, byteSize: response.ContentLength, body };
                },
            });
        } finally { if (abortBody) signal.removeEventListener('abort', abortBody); storage.destroy(); }
    } });
}
