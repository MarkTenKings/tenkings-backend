import assert from "node:assert/strict";
import test from "node:test";
import {
  createSpeedsterPresentationImages,
  PHOTOROOM_V2_EDIT_ENDPOINT,
} from "../lib/server/aiGraderV2PresentationImages";

const frontRectifiedStorageKey = "ai-grader-v2/admin-1/session-1/prepared/front/rectified.webp";
const backRectifiedStorageKey = "ai-grader-v2/admin-1/session-1/prepared/back/rectified.webp";
const frontCleanStorageKey = "ai-grader-v2/admin-1/session-1/report/front-clean.png";
const backCleanStorageKey = "ai-grader-v2/admin-1/session-1/report/back-clean.png";

test("front and back are cleaned in parallel on their original canvases", async () => {
  const reads: string[] = [];
  const forms: FormData[] = [];
  const uploads: Array<{ storageKey: string; bytes: string; contentType: string }> = [];
  let releasePhotoRoom!: () => void;
  const photoRoomReleased = new Promise<void>((resolve) => {
    releasePhotoRoom = resolve;
  });

  const processing = createSpeedsterPresentationImages({
    front: {
      sourceStorageKey: frontRectifiedStorageKey,
      sourceContentType: "image/webp",
      outputStorageKey: frontCleanStorageKey,
    },
    back: {
      sourceStorageKey: backRectifiedStorageKey,
      sourceContentType: "image/webp",
      outputStorageKey: backCleanStorageKey,
    },
    apiKey: "photo-room-key",
  }, {
    readStorageBuffer: async (storageKey) => {
      reads.push(storageKey);
      return Buffer.from(storageKey.includes("front") ? "front-source" : "back-source");
    },
    fetch: async (url, init) => {
      assert.equal(url, PHOTOROOM_V2_EDIT_ENDPOINT);
      assert.equal(init?.method, "POST");
      assert.equal((init?.headers as Record<string, string>)["x-api-key"], "photo-room-key");
      const form = init?.body as FormData;
      forms.push(form);
      await photoRoomReleased;
      return new Response(forms.length === 1 ? "front-clean" : "back-clean", {
        status: 200,
        headers: { "Content-Type": "image/png" },
      });
    },
    uploadBuffer: async (storageKey, buffer, contentType) => {
      uploads.push({ storageKey, bytes: buffer.toString(), contentType });
      return storageKey;
    },
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(reads.sort(), [backRectifiedStorageKey, frontRectifiedStorageKey].sort());
  assert.equal(forms.length, 2);
  releasePhotoRoom();

  const result = await processing;
  for (const form of forms) {
    assert.equal(form.get("removeBackground"), "true");
    assert.equal(form.get("referenceBox"), "originalImage");
    assert.equal(form.get("outputSize"), "originalImage");
    assert.equal(form.get("padding"), "0");
    assert.equal(form.get("scaling"), "fit");
    assert.equal(form.get("export.format"), "png");
    assert.equal(form.get("background.color"), "transparent");
  }
  assert.deepEqual(result, {
    frontCleanStorageKey,
    backCleanStorageKey,
  });
  assert.deepEqual(
    uploads.map(({ storageKey, contentType }) => ({ storageKey, contentType })).sort((a, b) => a.storageKey.localeCompare(b.storageKey)),
    [
      { storageKey: backCleanStorageKey, contentType: "image/png" },
      { storageKey: frontCleanStorageKey, contentType: "image/png" },
    ],
  );
  assert.equal(uploads.some(({ storageKey }) => storageKey.includes("/prepared/")), false);
});

test("missing PhotoRoom configuration stops without writing presentation images", async () => {
  let writes = 0;
  await assert.rejects(
    createSpeedsterPresentationImages({
      front: {
        sourceStorageKey: frontRectifiedStorageKey,
        sourceContentType: "image/webp",
        outputStorageKey: frontCleanStorageKey,
      },
      back: {
        sourceStorageKey: backRectifiedStorageKey,
        sourceContentType: "image/webp",
        outputStorageKey: backCleanStorageKey,
      },
      apiKey: "",
    }, {
      readStorageBuffer: async () => Buffer.alloc(0),
      fetch,
      uploadBuffer: async () => {
        writes += 1;
        return "unused";
      },
    }),
    /PHOTOROOM_API_KEY is required/,
  );
  assert.equal(writes, 0);
});

test("the PhotoRoom adapter accepts stage-independent source and destination keys", async () => {
  let uploaded = "";
  await createSpeedsterPresentationImages({
    front: {
      sourceStorageKey: "future-stage/front.jpg",
      sourceContentType: "image/jpeg",
      outputStorageKey: "presentation/front.png",
    },
    back: {
      sourceStorageKey: "future-stage/back.jpg",
      sourceContentType: "image/jpeg",
      outputStorageKey: "presentation/back.png",
    },
    apiKey: "photo-room-key",
  }, {
    readStorageBuffer: async () => Buffer.from("jpeg"),
    fetch: async (_url, init) => {
      const file = (init?.body as FormData).get("imageFile") as File;
      assert.equal(file.type, "image/jpeg");
      assert.match(file.name, /-source\.jpg$/);
      return new Response("clean", { status: 200, headers: { "Content-Type": "image/png" } });
    },
    uploadBuffer: async (storageKey) => {
      uploaded += storageKey;
      return storageKey;
    },
  });
  assert.match(uploaded, /presentation\/front\.png/);
  assert.match(uploaded, /presentation\/back\.png/);
});
