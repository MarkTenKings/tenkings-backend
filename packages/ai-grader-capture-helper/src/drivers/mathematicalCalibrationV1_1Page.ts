/** Minimal same-origin, calibration-only operator page.  The station token is
 * obtained through the existing one-time pairing exchange and retained only
 * in browser localStorage; it is never placed in a URL or written to logs. */
export const MATHEMATICAL_CALIBRATION_V1_1_PAGE_PATH = "/calibration/mathematical-v1.1" as const;

export const MATHEMATICAL_CALIBRATION_V1_1_PAGE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ten Kings Mathematical Calibration V1.1</title>
<style>
body{margin:0;background:#10130f;color:#f4f0df;font:16px system-ui,sans-serif}main{max-width:1180px;margin:0 auto;padding:18px}h1{font-size:22px;margin:0 0 12px}p{margin:6px 0;color:#c9c3b4}.grid{display:grid;grid-template-columns:minmax(0,1fr) 290px;gap:16px}.stage{position:relative;background:#000;border:1px solid #514f45;min-height:400px}.stage canvas{display:block;width:100%;height:auto}.panel{background:#1a1e18;border:1px solid #514f45;border-radius:6px;padding:14px}.row{display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid #30362d;padding:7px 0}.label{color:#aaa795}.value{font-variant-numeric:tabular-nums;text-align:right}.ok{color:#6dff9f}.bad{color:#ff8f83}.warn{color:#ffd36d}button{background:#d8bd72;border:0;border-radius:4px;padding:9px 13px;font-weight:700;cursor:pointer}button:disabled{opacity:.5;cursor:not-allowed}.small{font-size:12px;word-break:break-word}#message{margin:10px 0;min-height:22px}
</style></head><body><main>
<h1>Mathematical Calibration V1.1 — protected calibration only</h1>
<p>Production station, Rapid, NFC, F8215, and Pylon Viewer are not part of this page.</p>
<div id="message" class="warn">Pairing protected bridge…</div>
<div class="grid"><div class="stage"><canvas id="preview" width="1200" height="1680"></canvas></div>
<section class="panel"><div class="row"><span class="label">Preview</span><span id="previewState" class="value">stopped</span></div>
<div class="row"><span class="label">Pose valid</span><span id="valid" class="value">—</span></div>
<div class="row"><span class="label">Distinct</span><span id="distinct" class="value">—</span></div>
<div class="row"><span class="label">Pose count</span><span id="poses" class="value">0 / 4</span></div>
<div class="row"><span class="label">Center</span><span id="center" class="value">—</span></div>
<div class="row"><span class="label">Rotation</span><span id="rotation" class="value">—</span></div>
<div class="row"><span class="label">Coverage</span><span id="coverage" class="value">—</span></div>
<div class="row"><span class="label">Safety margin</span><span id="margin" class="value">—</span></div>
<p class="small">Move or rotate the target freely. Capture only when Pose valid and Distinct are both TRUE.</p>
<button id="reconnect" type="button">Reconnect preview</button> <button id="stop" type="button">Stop preview</button></section></div></main>
<script>
(() => {
  const tokenKey = "ten-kings-mathematical-calibration-bridge-token";
  const sessionId = new URL(location.href).searchParams.get("sessionId") || "";
  const tokenHeaders = () => ({"X-AI-Grader-Station-Token": localStorage.getItem(tokenKey) || ""});
  const calibrationHeaders = () => ({...tokenHeaders(), "X-AI-Grader-Mathematical-Calibration-Session-Id": sessionId});
  const el = (id) => document.getElementById(id);
  const canvas = el("preview");
  const context = canvas.getContext("2d");
  let streamReader;
  let streamAbort;
  let lastImage;
  function message(text, className) { el("message").textContent = text; el("message").className = className || ""; }
  function truth(value) { return value ? "TRUE" : "FALSE"; }
  function setStatus(status) {
    const preview = status || {};
    const overlay = preview.mathematicalCalibrationPreview && preview.mathematicalCalibrationPreview.overlay || {};
    el("previewState").textContent = preview.status || "stopped";
    el("previewState").className = "value " + (preview.status === "live" ? "ok" : "warn");
    el("valid").textContent = overlay.valid === undefined ? "—" : truth(overlay.valid);
    el("valid").className = "value " + (overlay.valid ? "ok" : "bad");
    el("distinct").textContent = overlay.sufficientlyDistinct === undefined ? "—" : truth(overlay.sufficientlyDistinct);
    el("distinct").className = "value " + (overlay.sufficientlyDistinct ? "ok" : "bad");
    el("poses").textContent = (overlay.placementIndex || 0) + " / 4";
    el("center").textContent = overlay.center ? overlay.center.xFraction.toFixed(4) + ", " + overlay.center.yFraction.toFixed(4) : "—";
    el("rotation").textContent = overlay.rotationDegrees === null || overlay.rotationDegrees === undefined ? "—" : overlay.rotationDegrees.toFixed(2) + "°";
    el("coverage").textContent = overlay.coverageFraction === null || overlay.coverageFraction === undefined ? "—" : (overlay.coverageFraction * 100).toFixed(2) + "%";
    el("margin").textContent = overlay.safetyMarginFraction === null || overlay.safetyMarginFraction === undefined ? "—" : (overlay.safetyMarginFraction * 100).toFixed(2) + "%";
    drawOverlay(overlay);
  }
  function drawOverlay(overlay) {
    if (!lastImage) return;
    canvas.width = lastImage.naturalWidth || lastImage.width;
    canvas.height = lastImage.naturalHeight || lastImage.height;
    context.drawImage(lastImage, 0, 0, canvas.width, canvas.height);
    const contour = overlay.outerContour;
    if (!contour || contour.length !== 4) return;
    context.save();
    context.lineWidth = Math.max(3, canvas.width / 500);
    context.strokeStyle = overlay.valid && overlay.sufficientlyDistinct ? "#62ff9b" : "#ff756b";
    context.beginPath(); contour.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y)); context.closePath(); context.stroke();
    const margin = (overlay.safetyMarginFraction || 0.01) * Math.min(canvas.width, canvas.height);
    context.strokeStyle = "rgba(255,211,109,.85)"; context.setLineDash([12,10]); context.strokeRect(margin, margin, canvas.width - margin * 2, canvas.height - margin * 2); context.restore();
  }
  async function pair() {
    if (localStorage.getItem(tokenKey)) return true;
    const match = location.hash.match(/(?:^|[#&])aiGraderBridgePair=([^&]+)/);
    if (!match) { message("Pairing code is required. Open this page from the protected calibration launcher.", "bad"); return false; }
    const response = await fetch("/pair", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({pairingCode:decodeURIComponent(match[1])})});
    if (!response.ok) throw new Error("Protected bridge pairing failed.");
    const body = await response.json();
    if (!body.result || typeof body.result.stationToken !== "string") throw new Error("Protected bridge pairing returned no token.");
    localStorage.setItem(tokenKey, body.result.stationToken);
    history.replaceState(null, "", location.pathname + location.search);
    return true;
  }
  async function refreshStatus() {
    if (!localStorage.getItem(tokenKey)) return;
    const response = await fetch("/preview/status", {headers:tokenHeaders(), cache:"no-store"});
    if (response.ok) setStatus((await response.json()).result);
  }
  async function readStream() {
    streamAbort = new AbortController();
    const response = await fetch("/preview/stream", {headers:calibrationHeaders(), signal:streamAbort.signal, cache:"no-store"});
    if (!response.ok) throw new Error("Preview stream was not accepted by the protected bridge.");
    streamReader = response.body.getReader();
    let buffer = new Uint8Array(0);
    while (true) {
      const part = await streamReader.read(); if (part.done) break;
      const next = new Uint8Array(buffer.length + part.value.length); next.set(buffer); next.set(part.value, buffer.length); buffer = next;
      while (true) {
        const headerEnd = buffer.indexOf ? buffer.indexOf(13) : -1;
        let marker = -1; for (let i=0;i+3<buffer.length;i++) if (buffer[i]===13&&buffer[i+1]===10&&buffer[i+2]===13&&buffer[i+3]===10){marker=i;break;}
        if (marker < 0) break;
        const header = new TextDecoder().decode(buffer.slice(0, marker)); const match = header.match(/Content-Length:\s*(\\d+)/i); if (!match) { buffer = buffer.slice(marker+4); continue; }
        const length = Number(match[1]); const start = marker + 4; if (buffer.length < start + length + 2) break;
        const frame = buffer.slice(start, start + length); buffer = buffer.slice(start + length + 2);
        const image = new Image(); image.onload = () => { lastImage = image; refreshStatus(); }; image.src = URL.createObjectURL(new Blob([frame], {type:"image/jpeg"}));
      }
    }
  }
  async function connect() {
    try { if (!sessionId) throw new Error("Calibration sessionId is missing from the protected launcher URL."); if (!await pair()) return; message("Connecting to protected calibration preview…", "warn"); if (streamAbort) streamAbort.abort(); await readStream(); if (streamAbort && !streamAbort.signal.aborted) setTimeout(() => connect(), 500); }
    catch (error) { if (error.name !== "AbortError") message(error.message || "Preview connection failed.", "bad"); }
  }
  function stop() { if (streamAbort) streamAbort.abort(); streamAbort = undefined; message("Preview stopped; camera is released for photometric capture.", "warn"); }
  el("reconnect").addEventListener("click", connect);
  el("stop").addEventListener("click", stop);
  setInterval(() => refreshStatus().catch(() => {}), 250);
  connect();
})();
</script></body></html>`;
