const API = "https://collect.tenkings.co/api/ai-grader-v2/iphone-capture";

export async function handleCapture(request, fetcher = fetch) {
  if (request.method !== "POST") return new Response("POST only", { status: 405 });

  const form = await request.formData();
  const deviceId = form.get("deviceId");
  const front = form.get("front");
  const back = form.get("back");
  if (typeof deviceId !== "string" || !(front instanceof File) || !(back instanceof File)) {
    return new Response("Expected deviceId, front, and back", { status: 400 });
  }

  const sha256 = async (file) => Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  const [frontChecksumSha256, backChecksumSha256] = await Promise.all([sha256(front), sha256(back)]);
  const manifest = {
    front: { byteSize: front.size, checksumSha256: frontChecksumSha256 },
    back: { byteSize: back.size, checksumSha256: backChecksumSha256 },
  };

  const planResponse = await fetcher(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "PLAN", deviceId, ...manifest }),
  });
  if (!planResponse.ok) {
    return new Response(await planResponse.text(), { status: planResponse.status });
  }
  const plan = await planResponse.json();

  if (typeof plan.frontUploadUrl !== "string" || typeof plan.backUploadUrl !== "string"
    || !plan.frontUploadHeaders || !plan.backUploadHeaders) {
    return new Response("Capture API returned an invalid upload plan", { status: 502 });
  }
  const upload = (url, headers, file) => fetcher(url, {
    method: "PUT",
    headers,
    body: file,
  });
  const [frontResponse, backResponse] = await Promise.all([
    upload(plan.frontUploadUrl, plan.frontUploadHeaders, front),
    upload(plan.backUploadUrl, plan.backUploadHeaders, back),
  ]);
  if (!frontResponse.ok || !backResponse.ok) {
    return new Response(
      `Upload failed (front ${frontResponse.status}, back ${backResponse.status})`,
      { status: 502 },
    );
  }

  const completeResponse = await fetcher(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "COMPLETE", deviceId, uploadVersion: plan.uploadVersion, ...manifest }),
  });
  return new Response(await completeResponse.text(), {
    status: completeResponse.status,
    headers: { "Content-Type": "application/json" },
  });
}

export default {
  fetch(request) {
    return handleCapture(request);
  },
};
