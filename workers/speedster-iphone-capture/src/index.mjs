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

  const planResponse = await fetcher(API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "PLAN", deviceId }),
  });
  if (!planResponse.ok) {
    return new Response(await planResponse.text(), { status: planResponse.status });
  }
  const plan = await planResponse.json();

  const upload = (url, file) => fetcher(url, {
    method: "PUT",
    headers: { "Content-Type": "image/jpeg" },
    body: file,
  });
  const [frontResponse, backResponse] = await Promise.all([
    upload(plan.frontUploadUrl, front),
    upload(plan.backUploadUrl, back),
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
    body: JSON.stringify({ action: "COMPLETE", deviceId, uploadVersion: plan.uploadVersion }),
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
