/** Minimal same-origin, calibration-only operator page.  The station token is
 * obtained through the existing one-time pairing exchange and retained only
 * in browser localStorage; it is never placed in a URL or written to logs. */
export const MATHEMATICAL_CALIBRATION_V1_PAGE_PATH = "/calibration/mathematical-v1" as const;

export const MATHEMATICAL_CALIBRATION_V1_PAGE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ten Kings Mathematical Calibration V1.0.1</title>
<style>
body{margin:0;background:#10130f;color:#f4f0df;font:15px system-ui,sans-serif}main{max-width:1280px;margin:0 auto;padding:16px}h1{font-size:22px;margin:0 0 8px}p{margin:5px 0;color:#c9c3b4}.grid{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:14px}.stage{background:#000;border:1px solid #514f45;min-height:420px}.stage canvas{display:block;width:100%;height:auto}.panel{background:#1a1e18;border:1px solid #514f45;border-radius:6px;padding:12px}.row{display:flex;justify-content:space-between;gap:10px;border-bottom:1px solid #30362d;padding:6px 0}.label{color:#aaa795}.value{font-variant-numeric:tabular-nums;text-align:right;word-break:break-word}.ok{color:#6dff9f}.bad{color:#ff8f83}.warn{color:#ffd36d}.small{font-size:12px;word-break:break-word}.history{max-height:150px;overflow:auto;white-space:pre-wrap;background:#11140f;padding:8px}button{background:#d8bd72;border:0;border-radius:4px;padding:9px 13px;font-weight:700;cursor:pointer}#message{margin:8px 0;min-height:22px}
</style></head><body><main>
<h1>Mathematical Calibration V1.0.1 - isolated 102-capture operator preview</h1>
<p>Advisory positioning only. Capture authority reruns detection against the exact captured still. Production, NFC, grading, and activation are not available here.</p>
<div id="message" class="warn">Pairing protected bridge...</div>
<div class="grid"><div class="stage"><canvas id="preview" width="1200" height="1680"></canvas></div>
<section class="panel">
<div class="row"><span class="label">Preview</span><span id="previewState" class="value">stopped</span></div>
<div class="row"><span class="label">Session / epoch</span><span id="binding" class="value small">-</span></div>
<div class="row"><span class="label">Next exact slot</span><span id="slot" class="value">-</span></div>
<div class="row"><span class="label">Detected pose</span><span id="pose" class="value">-</span></div>
<div class="row"><span class="label">Coverage</span><span id="coverage" class="value">-</span></div>
<div class="row"><span class="label">Detector guidance</span><span id="guidance" class="value small">waiting for frame</span></div>
<div class="row"><span class="label">Lens aggregate X/Y/rot</span><span id="lens" class="value">0 / 0 / 0</span></div>
<div class="row"><span class="label">Normalization aggregate X/Y/rot</span><span id="normalization" class="value">0 / 0 / 0</span></div>
<div class="row"><span class="label">Accepted / failed</span><span id="counts" class="value">0 / 0</span></div>
<p class="small">Accepted history (operation, slot, raw SHA-256)</p><div id="history" class="history small">none</div>
<p class="small">Failed attempts (operation, same pending slot, reason)</p><div id="failures" class="history small">none</div>
<button id="reconnect" type="button">Reconnect fresh preview epoch</button> <button id="stop" type="button">Stop preview</button>
</section></div></main>
<script>
(() => {
  const tokenKey = "ten-kings-mathematical-calibration-bridge-token";
  const sessionId = new URL(location.href).searchParams.get("sessionId") || "";
  const tokenHeaders = () => ({"X-AI-Grader-Station-Token": localStorage.getItem(tokenKey) || ""});
  const calibrationHeaders = () => ({...tokenHeaders(), "X-AI-Grader-Mathematical-Calibration-Session-Id": sessionId});
  const el = (id) => document.getElementById(id); const canvas = el("preview"); const context = canvas.getContext("2d");
  let streamAbort; let lastImage; let imageSequence=0;
  function message(text, cls) { el("message").textContent = text; el("message").className = cls || ""; }
  function fmt(value) { return typeof value === "number" ? value.toFixed(4) : "-"; }
  function aggregate(progress) { const a=progress&&progress.currentAggregate||{}; const r=progress&&progress.requiredAggregate||{}; return fmt(a.x)+"/"+fmt(r.x)+"; "+fmt(a.y)+"/"+fmt(r.y)+"; "+fmt(a.rotationDegrees)+"/"+fmt(r.rotationDegrees)+" deg ("+(progress&&progress.acceptedCount||0)+"/10)"; }
  function drawOverlay(overlay) { if(!lastImage)return; canvas.width=lastImage.naturalWidth||lastImage.width; canvas.height=lastImage.naturalHeight||lastImage.height; context.drawImage(lastImage,0,0,canvas.width,canvas.height); const c=overlay&&overlay.outerContour; if(!c||c.length!==4)return; context.save(); context.lineWidth=Math.max(3,canvas.width/500); context.strokeStyle=overlay.valid?"#62ff9b":"#ff756b"; context.beginPath(); c.forEach((p,i)=>i?context.lineTo(p.x,p.y):context.moveTo(p.x,p.y)); context.closePath(); context.stroke(); context.restore(); }
  function setStatus(preview, session) {
    const math=preview&&preview.mathematicalCalibrationPreview; const overlay=math&&math.overlay||{};
    const bound=math&&math.contractVersion==="1.0.1"&&math.sessionId===sessionId;
    el("previewState").textContent=preview&&preview.status||"stopped"; el("previewState").className="value "+(preview&&preview.status==="live"&&bound?"ok":"warn");
    const displayed=math&&math.displayedFrame; el("binding").textContent=(math&&math.sessionId||"-")+" / "+(preview&&preview.sideEpoch||"-")+" / "+(displayed&&displayed.frameId||"-")+" / "+(displayed&&displayed.capturedAt||"-");
    const slot=session&&session.nextCaptureSlot; el("slot").textContent=slot?slot.slotKey:"complete";
    el("pose").textContent=overlay.center?fmt(overlay.center.xFraction)+", "+fmt(overlay.center.yFraction)+", "+fmt(overlay.rotationDegrees)+" deg":"not detected";
    el("coverage").textContent=typeof overlay.coverageFraction==="number"?(overlay.coverageFraction*100).toFixed(2)+"%":"-";
    el("guidance").textContent=(overlay.guidance||overlay.reasons||["waiting for detector"]).join("; ");
    const progress=session&&session.poseProgress||[]; el("lens").textContent=aggregate(progress.find(p=>p.role==="lens_geometry")); el("normalization").textContent=aggregate(progress.find(p=>p.role==="normalization_registration"));
    const accepted=session&&session.acceptedCaptureHistory||[]; const failures=session&&session.failedAttempts||[]; el("counts").textContent=accepted.length+" / "+failures.length;
    el("history").textContent=accepted.length?accepted.map(x=>x.operationId+" | "+x.slotKey+" | "+x.rawSha256).join("\\n"):"none";
    el("failures").textContent=failures.length?failures.map(x=>x.operationId+" | "+(x.slotKey||"-")+" | "+(x.candidateRawSha256||"no still hash")+" | "+x.error).join("\\n"):"none";
    if(!bound&&math)message("Wrong calibration session or contract binding; this frame cannot authorize capture.","bad"); drawOverlay(overlay);
  }
  async function pair(){ if(localStorage.getItem(tokenKey))return true; const m=location.hash.match(/(?:^|[#&])aiGraderBridgePair=([^&]+)/); if(!m){message("Pairing code required; use the protected V1.0.1 launcher.","bad");return false;} const r=await fetch("/pair",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({pairingCode:decodeURIComponent(m[1])})}); if(!r.ok)throw new Error("Protected bridge pairing failed."); const b=await r.json(); if(!b.result||typeof b.result.stationToken!=="string")throw new Error("Pairing returned no station token."); localStorage.setItem(tokenKey,b.result.stationToken); history.replaceState(null,"",location.pathname+location.search); return true; }
  async function refreshStatus(){ if(!localStorage.getItem(tokenKey))return; const [p,s]=await Promise.all([fetch("/preview/status",{headers:tokenHeaders(),cache:"no-store"}),fetch("/calibration/mathematical-v1/status?sessionId="+encodeURIComponent(sessionId),{headers:tokenHeaders(),cache:"no-store"})]); if(p.ok&&s.ok){const preview=(await p.json()).result;setStatus(preview,(await s.json()).result);return preview;} }
  function exactHeader(header,name){const prefix=name.toLowerCase()+":";const values=header.split(String.fromCharCode(13,10)).filter(line=>line.toLowerCase().startsWith(prefix)).map(line=>line.slice(prefix.length).trim());if(values.length!==1||!values[0])throw new Error("MJPEG frame requires exactly one "+name+" header.");return values[0];}
  function parseDisplayedFrame(header){const frame={sessionId:exactHeader(header,"X-AI-Grader-Session-Id"),epoch:exactHeader(header,"X-AI-Grader-Preview-Epoch"),frameId:exactHeader(header,"X-AI-Grader-Frame-Id"),capturedAt:exactHeader(header,"X-AI-Grader-Captured-At")};if(frame.sessionId!==sessionId)throw new Error("Displayed MJPEG frame has the wrong calibration session.");if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(frame.epoch)||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(frame.frameId)||!Number.isFinite(Date.parse(frame.capturedAt)))throw new Error("Displayed MJPEG frame identity is invalid.");return frame;}
  async function acknowledgeDisplayedFrame(frame){const r=await fetch("/calibration/mathematical-v1/displayed-frame",{method:"POST",headers:{...tokenHeaders(),"Content-Type":"application/json"},body:JSON.stringify(frame)});if(!r.ok)throw new Error("Protected bridge rejected the exact displayed MJPEG frame.");}
  async function readStream(){ streamAbort=new AbortController(); const r=await fetch("/preview/stream",{headers:calibrationHeaders(),signal:streamAbort.signal,cache:"no-store"}); if(!r.ok)throw new Error("Protected preview stream rejected this session binding."); const reader=r.body.getReader(); let buffer=new Uint8Array(0); while(true){const part=await reader.read();if(part.done)break;const next=new Uint8Array(buffer.length+part.value.length);next.set(buffer);next.set(part.value,buffer.length);buffer=next;while(true){let marker=-1;for(let i=0;i+3<buffer.length;i++)if(buffer[i]===13&&buffer[i+1]===10&&buffer[i+2]===13&&buffer[i+3]===10){marker=i;break;}if(marker<0)break;const header=new TextDecoder().decode(buffer.slice(0,marker));const match=header.match(/Content-Length: *([0-9]+)/i);if(!match){buffer=buffer.slice(marker+4);continue;}const identity=parseDisplayedFrame(header);const length=Number(match[1]),start=marker+4;if(buffer.length<start+length+2)break;const frame=buffer.slice(start,start+length);buffer=buffer.slice(start+length+2);const image=new Image();const sequence=++imageSequence;const imageUrl=URL.createObjectURL(new Blob([frame],{type:"image/jpeg"}));image.onload=()=>{if(sequence!==imageSequence){URL.revokeObjectURL(imageUrl);return;}lastImage=image;canvas.width=image.naturalWidth||image.width;canvas.height=image.naturalHeight||image.height;context.drawImage(image,0,0,canvas.width,canvas.height);URL.revokeObjectURL(imageUrl);acknowledgeDisplayedFrame(identity).then(()=>refreshStatus()).catch(error=>message(error.message||"Displayed-frame acknowledgement failed.","bad"));};image.onerror=()=>URL.revokeObjectURL(imageUrl);image.src=imageUrl;}} }
  async function reconnectAfterCapture(){try{const preview=await refreshStatus();if(preview&&preview.status==="paused_for_capture"){message("Exact displayed frame authorized; preview is drained for sole capture ownership.","warn");setTimeout(reconnectAfterCapture,250);return;}if(streamAbort&&!streamAbort.signal.aborted)setTimeout(connect,100);}catch(error){message(error.message||"Preview lifecycle status failed.","bad");}}
  async function connect(){try{if(!sessionId)throw new Error("sessionId is missing from protected launcher URL.");if(!await pair())return;message("Connecting a fresh session-bound preview epoch...","warn");if(streamAbort)streamAbort.abort();await readStream();if(streamAbort&&!streamAbort.signal.aborted)reconnectAfterCapture();}catch(error){if(error.name!=="AbortError")message(error.message||"Preview connection failed.","bad");}}
  function stop(){if(streamAbort)streamAbort.abort();streamAbort=undefined;message("Preview stopped; camera release is required before blank-reverse capture.","warn");}
  el("reconnect").addEventListener("click",connect); el("stop").addEventListener("click",stop); setInterval(()=>refreshStatus().catch(()=>{}),250); connect();
})();
</script></body></html>`;

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
