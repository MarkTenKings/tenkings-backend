import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { joinUrl } from "../utils";

type SpacesConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  baseUrl: string;
  prefix: string;
};

function loadSpacesConfig(): SpacesConfig {
  const endpoint = process.env.SPACES_ENDPOINT ?? "";
  const region = process.env.SPACES_REGION ?? "";
  const bucket = process.env.SPACES_BUCKET ?? "";
  const accessKeyId = process.env.SPACES_ACCESS_KEY_ID ?? "";
  const secretAccessKey = process.env.SPACES_SECRET_ACCESS_KEY ?? "";
  const baseUrl = process.env.SPACES_BASE_URL ?? "";
  const prefix = process.env.SPACES_PREFIX ?? "bytebot-lite";

  const missing = [
    ["SPACES_ENDPOINT", endpoint],
    ["SPACES_REGION", region],
    ["SPACES_BUCKET", bucket],
    ["SPACES_ACCESS_KEY_ID", accessKeyId],
    ["SPACES_SECRET_ACCESS_KEY", secretAccessKey],
    ["SPACES_BASE_URL", baseUrl],
  ].filter(([, value]) => !value);

  if (missing.length > 0) {
    const keys = missing.map(([key]) => key).join(", ");
    throw new Error(`Missing Spaces config: ${keys}`);
  }

  return {
    endpoint,
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    baseUrl,
    prefix,
  };
}

export type UploadResult = {
  key: string;
  url: string;
};

export function createSpacesUploader() {
  const config = loadSpacesConfig();
  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  return async function uploadBuffer(
    buffer: Buffer,
    key: string,
    contentType: string
  ): Promise<UploadResult> {
    const objectKey = `${config.prefix}/${key}`;
    await client.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: objectKey,
        Body: buffer,
        ContentType: contentType,
        ACL: "public-read",
      })
    );

    return {
      key: objectKey,
      url: joinUrl(config.baseUrl, objectKey),
    };
  };
}
