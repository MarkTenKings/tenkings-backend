import { useEffect, useRef, useState } from 'react';
import { decodeSpeedsterTraceBitmapWireV1 } from '@atlas/grading-core/trace-bitmap-wire';

const words = value => value.replaceAll('_', ' ').toLowerCase();
function TracePixels({ pixels }) {
    const canvas = useRef(null);
    useEffect(() => {
        const context = canvas.current.getContext('2d'), data = context.createImageData(1270, 1778);
        for (let i = 0; i < pixels.length; i++) if (pixels[i]) data.data.set([211, 88, 35, 200], i * 4);
        context.putImageData(data, 0, 0);
    }, [pixels]);
    return <canvas ref={canvas} width="1270" height="1778" aria-hidden="true"/>;
}
function Photograph({ packet, side, findings, trace, overlays, traceRequired }) {
    const [failed, setFailed] = useState(false), [loaded, setLoaded] = useState(false);
    const photo = useRef(null);
    const src = `/api/reports/${packet.publicToken}/images/${side}?v=${packet.approvalVersion}`;
    useEffect(() => {
        // Fast SSR image responses can finish before React attaches onLoad.
        if (photo.current?.complete) { setLoaded(photo.current.naturalWidth > 0); setFailed(photo.current.naturalWidth === 0); }
    }, [src]);
    return <div className="approved-photo" style={{ aspectRatio: `${packet.images[side].width} / ${packet.images[side].height}` }}>
        {!failed && <img ref={photo} src={src} alt={`Approved ${words(side)} photograph, version ${packet.approvalVersion}`}
            onLoad={() => setLoaded(true)} onError={() => { setFailed(true); setLoaded(false); }}/>}
        {failed && <p className="photo-error">Photograph temporarily unavailable.</p>}
        {!failed && !loaded && <p className="photo-error">Loading photograph…</p>}
        {loaded && overlays && (trace?.side === side ? <TracePixels pixels={trace.pixels}/> : !traceRequired ? <svg viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
            {findings.filter(f => f.side === side).flatMap(f => (f.measurementRegions ?? [f]).map((r, i) =>
                <polygon key={`${f.id}:${i}`} points={r.canonicalContour.map(p => `${p.x},${p.y}`).join(' ')} fill="#d3582333" stroke="#d35823" strokeWidth="0.004"/>))}
        </svg> : null)}
    </div>;
}
export default function ApprovedPhotographs({ packet, publicHash }) {
    const [selected, setSelected] = useState(''), [trace, setTrace] = useState(null), [message, setMessage] = useState('');
    const [overlays, setOverlays] = useState(true), [enlarged, setEnlarged] = useState('FRONT');
    const dialog = useRef(null), finding = packet.report.findings.find(f => f.id === selected);
    const findings = finding ? [finding] : packet.report.findings;
    useEffect(() => {
        setTrace(null); setMessage('');
        if (!finding?.traceSha256) return;
        const controller = new AbortController(); let live = true;
        setMessage('Loading the approved pixel trace…');
        (async () => {
            const response = await fetch(`/api/reports/${packet.publicToken}/traces/${encodeURIComponent(finding.id)}?v=${packet.approvalVersion}`,
                { signal: controller.signal, credentials: 'omit', redirect: 'error', cache: 'no-store' });
            if (!response.ok) throw new Error();
            const reader = response.body.getReader(), chunks = []; let length = 0;
            try {
                while (true) {
                    const next = await reader.read(); if (next.done) break;
                    length += next.value.length; if (length > 400_000) throw new Error(); chunks.push(next.value);
                }
            } finally { await reader.cancel().catch(() => {}); }
            const bytes = new Uint8Array(length); let offset = 0;
            for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
            const value = JSON.parse(new TextDecoder().decode(bytes));
            if (value.publicHash !== publicHash || value.side !== finding.side || value.traceWire?.rleSha256 !== finding.traceSha256) throw new Error();
            const pixels = decodeSpeedsterTraceBitmapWireV1(value.traceWire);
            if (live) { setTrace({ side: finding.side, pixels }); setMessage('Showing the approved pixel trace.'); }
        })().catch(() => { if (live) setMessage('The approved pixel trace is temporarily unavailable.'); });
        return () => { live = false; controller.abort(); };
    }, [finding, packet.publicToken, packet.approvalVersion, publicHash]);
    if (!packet.images) return null;
    return <section className="approved-photographs" aria-label="Approved card photographs">
        <div className="photos-heading"><div><p className="eyebrow">APPROVED PHOTOGRAPHS</p><h2>Inspect the card</h2></div><p className="muted">Version {packet.approvalVersion}</p></div>
        {packet.report.findings.length > 0 && <div className="photo-controls"><label>Finding<select value={selected} onChange={e => setSelected(e.target.value)}>
            <option value="">All measurement outlines</option>{packet.report.findings.map((f, i) => <option key={f.id} value={f.id}>{i + 1}. {words(f.side)} · {words(f.defectType)}</option>)}
        </select></label><label className="overlay-toggle"><input type="checkbox" checked={overlays} onChange={e => setOverlays(e.target.checked)}/> Show markings</label></div>}
        <p className="photo-caption" role="status">{message || (packet.report.findings.length ? 'Orange outlines show approved measurement regions. Select a finding to inspect its saved trace.' : 'No included findings in this report.')}</p>
        <div className="approved-photo-grid">{['FRONT', 'BACK'].map(side => <figure key={side}><button className="photo-open" onClick={() => { setEnlarged(side); dialog.current.showModal(); }} aria-label={`Enlarge ${words(side)} photograph`}>
            <Photograph packet={packet} side={side} findings={findings} trace={trace} overlays={overlays} traceRequired={!!finding?.traceSha256}/>
        </button><figcaption>{words(side)}<span>Click to enlarge</span></figcaption></figure>)}</div>
        <dialog ref={dialog} className="photo-dialog"><div className="photo-dialog-heading"><h2>Approved {words(enlarged)} photograph</h2><button onClick={() => dialog.current.close()}>Close</button></div>
            <Photograph key={enlarged} packet={packet} side={enlarged} findings={findings} trace={trace} overlays={overlays} traceRequired={!!finding?.traceSha256}/>
            <p className="photo-caption">Version {packet.approvalVersion} · {overlays ? 'Approved markings shown when available' : 'Markings hidden'}</p>
        </dialog>
    </section>;
}
