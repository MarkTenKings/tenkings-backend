import { config } from "../config";

const DEFAULT_ENDPOINT = "https://api.photoroom.com/v1/edit";

export async function runPhotoroom(buffer: Buffer): Promise<Buffer> {
  if (!config.photoroomApiKey) {
    return buffer;
  }

  const endpoint = config.photoroomApiUrl?.trim() || DEFAULT_ENDPOINT;

  const form = new FormData();
  const blob = new Blob([buffer], { type: "image/jpeg" });
  form.append("image_file", blob, "capture.jpg");
  form.append("background", "transparent");
  form.append("size", "1024");
  form.append("padding", "0.05");

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "x-api-key": config.photoroomApiKey,
    },
    body: form,
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(`PhotRoom request failed (${response.status}): ${message}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
