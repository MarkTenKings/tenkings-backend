import { readStorageBuffer, uploadBuffer } from "./storage";

export const PHOTOROOM_V2_EDIT_ENDPOINT = "https://image-api.photoroom.com/v2/edit";

type CardSide = "FRONT" | "BACK";
type SupportedImageContentType = "image/jpeg" | "image/png" | "image/webp";

export type SpeedsterPresentationImageInput = {
  sourceStorageKey: string;
  sourceContentType: SupportedImageContentType;
  outputStorageKey: string;
};

type Dependencies = {
  fetch: typeof fetch;
  readStorageBuffer: typeof readStorageBuffer;
  uploadBuffer: typeof uploadBuffer;
};

const defaultDependencies: Dependencies = {
  fetch,
  readStorageBuffer,
  uploadBuffer,
};

async function cleanPresentationImage(input: {
  side: CardSide;
  image: SpeedsterPresentationImageInput;
  apiKey: string;
}, dependencies: Dependencies) {
  const source = await dependencies.readStorageBuffer(input.image.sourceStorageKey);
  const extension = input.image.sourceContentType === "image/jpeg"
    ? "jpg"
    : input.image.sourceContentType.split("/")[1];
  const form = new FormData();
  form.append(
    "imageFile",
    new Blob([source], { type: input.image.sourceContentType }),
    `${input.side.toLowerCase()}-source.${extension}`,
  );
  form.append("removeBackground", "true");
  form.append("referenceBox", "originalImage");
  form.append("outputSize", "originalImage");
  form.append("padding", "0");
  form.append("scaling", "fit");
  form.append("export.format", "png");
  form.append("background.color", "transparent");

  const response = await dependencies.fetch(PHOTOROOM_V2_EDIT_ENDPOINT, {
    method: "POST",
    headers: {
      "x-api-key": input.apiKey,
      Accept: "image/png",
    },
    body: form,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`PhotoRoom ${input.side} edit failed (${response.status})${detail ? `: ${detail}` : ""}`);
  }

  await dependencies.uploadBuffer(
    input.image.outputStorageKey,
    Buffer.from(await response.arrayBuffer()),
    "image/png",
  );
  return input.image.outputStorageKey;
}

export async function createSpeedsterPresentationImages(input: {
  front: SpeedsterPresentationImageInput;
  back: SpeedsterPresentationImageInput;
  apiKey?: string;
}, dependencies: Dependencies = defaultDependencies) {
  const apiKey = String(input.apiKey ?? process.env.PHOTOROOM_API_KEY ?? "").trim();
  if (!apiKey) throw new Error("PHOTOROOM_API_KEY is required for Speedster presentation images.");

  const [frontCleanStorageKey, backCleanStorageKey] = await Promise.all([
    cleanPresentationImage({
      side: "FRONT",
      image: input.front,
      apiKey,
    }, dependencies),
    cleanPresentationImage({
      side: "BACK",
      image: input.back,
      apiKey,
    }, dependencies),
  ]);

  return { frontCleanStorageKey, backCleanStorageKey };
}
