import { config } from "../config";

const DEFAULT_ENDPOINT = "https://image-api.photoroom.com/v2/edit";

export async function runPhotoroom(buffer: Buffer): Promise<Buffer> {
  if (!config.photoroomApiKey) {
    return buffer;
  }

  const endpoint = config.photoroomApiUrl?.trim() || DEFAULT_ENDPOINT;

  const form = new FormData();
  const blob = new Blob([buffer], { type: "image/png" });
  form.append("imageFile", blob, "capture.png");
  form.append("removeBackground", "true");
  form.append("padding", "0.05");
  form.append("scaling", "fit");
  form.append("outputSize", "croppedSubject");
  form.append("export.format", "png");
  form.append("background.color", "transparent");

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "x-api-key": config.photoroomApiKey,
      Accept: "image/png, application/json",
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
