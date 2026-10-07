import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { approvedReportUrl } from '@atlas/finishing/browser';
import styles from './ApprovedLabel.module.css';

// Physical coordinate source: nextjs-app/lib/aiGraderLabelV1.ts approved V1 manifest.
// ATLAS content is exclusively the server receipt parsed from immutable labelCanonical.
const WIDTH = 196.56, HEIGHT = 59.76, FONT = 'Arial, sans-serif';
function labelContent(receipt) {
    const label = receipt?.label;
    if (!label || label.version !== 'atlas-approved-slab-label-v1' || label.labelIssueId !== receipt.id
        || label.approvalId !== receipt.approvalId || !/^ATLAS-[A-F0-9]{12}$/.test(label.reportNumber)
        || label.url !== approvedReportUrl(label.publicToken, label.approvalVersion)
        || !['SPORTS', 'POKEMON'].includes(label.cardProfile) || !['PRODUCTION', 'LOCAL_FIXTURE'].includes(label.mode)) throw new Error('This saved label could not be verified.');
    const identity = label.identity, grade = label.grade?.overall?.displayGrade;
    const name = label.cardProfile === 'SPORTS' ? identity?.playerName : identity?.cardName;
    const lines = [name, [identity?.year, label.cardProfile === 'SPORTS' ? identity?.manufacturer : null, identity?.productSet].filter(Boolean).join(' '),
        [identity?.parallel, identity?.insert, identity?.cardNumber ? `#${identity.cardNumber}` : null].filter(Boolean).join(' ')].filter(Boolean);
    if (!name || lines.some(s => typeof s !== 'string' || s.length > 550 || /[\r\n\u0000-\u001f]/.test(s))
        || !Number.isFinite(grade) || grade < 0 || grade > 10) throw new Error('This saved label is incomplete.');
    return { ...label, lines, displayGrade: String(grade) };
}
function fitLines(lines, context) {
    // Fit every identity character; never silently truncate an approved name or number.
    for (let size = 6.8; size >= 5.19; size -= 0.2) {
        context.font = `600 ${size}px Arial`;
        const out = []; let impossible = false;
        for (const paragraph of lines) {
            let line = '';
            for (const word of paragraph.split(/\s+/)) {
                if (context.measureText(word).width > 81.5) { impossible = true; break; }
                if (line && context.measureText(`${line} ${word}`).width > 81.5) { out.push(line); line = word; }
                else line = line ? `${line} ${word}` : word;
            }
            if (line) out.push(line);
        }
        if (!impossible && out.length * (size + 1.2) <= 44) return { lines: out, size, leading: size + 1.2 };
    }
    throw new Error('This full identity needs a reviewed label layout before it can be printed.');
}
export default function ApprovedLabel({ receipt, printDisabled = false }) {
    const [layout, setLayout] = useState(null), [error, setError] = useState(''), [printError, setPrintError] = useState('');
    const printRoot = useRef(null), printWindow = useRef(null);
    useEffect(() => {
        let active = true; setLayout(null); setError('');
        try {
            const content = labelContent(receipt), context = document.createElement('canvas').getContext('2d');
            if (!context) throw new Error('Label measurement is not available in this browser.');
            const fitted = fitLines(content.lines, context);
            let gradeSize = 22;
            for (; gradeSize >= 7; gradeSize -= .5) { context.font = `700 ${gradeSize}px Arial`; if (context.measureText(content.displayGrade).width <= 26.2) break; }
            if (gradeSize < 7) throw new Error('The saved grade needs a reviewed label layout before printing.');
            const code = QRCode.create(content.url, { errorCorrectionLevel: 'M' }), size = code.modules.size;
            const segments = [];
            for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) if (code.modules.get(row, col)) segments.push(`M${col + 4} ${row + 4}h1v1h-1z`);
            if (active) setLayout({ ...content, fitted, gradeSize, qrPath: segments.join(''), qrSize: size + 8 });
        } catch (e) { if (active) setError(e.message); }
        return () => { active = false; printWindow.current?.close(); printWindow.current = null; };
    }, [receipt]);
    function print() {
        if (!layout || printDisabled || !printRoot.current) return;
        // This explicit click opens a same-origin print document; the staff CSP keeps
        // frame-src none. DOM/SVG nodes are cloned without HTML injection or external assets.
        setPrintError(''); printWindow.current?.close();
        const owned = window.open('about:blank', '_blank', 'popup,width=760,height=620');
        if (!owned) { setPrintError('Allow this print popup, then click Print this saved label again.'); return; }
        printWindow.current = owned; owned.opener = null;
        const doc = owned.document, style = doc.createElement('style');
        style.textContent = '@page{size:letter;margin:1in}body{margin:0;color:#000;background:#fff}.face{width:2.73in;height:.83in;margin-bottom:.25in;break-inside:avoid}svg{display:block;width:2.73in;height:.83in}';
        doc.head.append(style); doc.title = `${layout.reportNumber} v${layout.approvalVersion}`;
        for (const svg of printRoot.current.querySelectorAll('[data-label-face]')) {
            const face = doc.createElement('div'); face.className = 'face'; face.append(svg.cloneNode(true)); doc.body.append(face);
        }
        owned.focus(); owned.print();
    }
    if (error) return <p className={styles.error} role="alert">{error}</p>;
    if (!layout) return <p role="status">Preparing the saved label preview…</p>;
    const { fitted } = layout;
    return <div className={styles.preview}>
      <div className={styles.faces} ref={printRoot}>
        <figure><figcaption>Front · reserved NFC area</figcaption><svg data-label-face="front" xmlns="http://www.w3.org/2000/svg" width="2.73in" height="0.83in" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`ATLAS ${layout.reportNumber} version ${layout.approvalVersion}, grade ${layout.displayGrade}`}>
          <rect x=".25" y=".25" width={WIDTH - .5} height={HEIGHT - .5} fill="white" stroke="#555" strokeWidth=".5"/>
          <g fill="#101010" fontFamily={FONT} textAnchor="middle">
            <text x="22" y="27" fontSize="11.2" fontWeight="700" letterSpacing=".6">ATLAS</text><text x="22" y="35" fontSize="4.3" letterSpacing=".9">GRADING</text>
            {layout.mode === 'LOCAL_FIXTURE' && <text x="22" y="43" fontSize="4.4" fontWeight="700">TEST FIXTURE</text>}
            <path d="M44 8V51.76M132.5 8V51.76" stroke="#333" strokeWidth=".5"/>
            {fitted.lines.map((line, i) => <text key={i} x="88.75" y={7 + (44 - fitted.lines.length * fitted.leading) / 2 + fitted.size + i * fitted.leading} fontSize={fitted.size} fontWeight={i === 0 ? '600' : '400'}>{line}</text>)}
            <circle cx="149.84" cy="29.88" r="12.7559055" fill="none" stroke="#555" strokeWidth=".5" strokeDasharray="1.4 1.4"/>
            <text x="149.84" y="31.8" fontSize="5.4">NFC</text><text x="181.35" y="36.5" fontSize={layout.gradeSize} fontWeight="700">{layout.displayGrade}</text>
            <text x="98.28" y="56" fontSize="5.2" letterSpacing=".1">{layout.reportNumber} · APPROVED v{layout.approvalVersion}</text>
          </g>
        </svg></figure>
        <figure><figcaption>Reverse · exact approved report QR</figcaption><svg data-label-face="reverse" xmlns="http://www.w3.org/2000/svg" width="2.73in" height="0.83in" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`QR for ${layout.url}`}>
          <rect x=".25" y=".25" width={WIDTH - .5} height={HEIGHT - .5} fill="white" stroke="#555" strokeWidth=".5"/>
          <g fill="#101010" fontFamily={FONT}>
            <text x="7" y="16" fontSize="12" fontWeight="700" letterSpacing="1">ATLAS</text>
            <text x="7" y="27" fontSize="6.4">{layout.reportNumber}</text><text x="7" y="37" fontSize="6">Approved report · version {layout.approvalVersion}</text>
            <text x="7" y="48" fontSize="6">atlasgrading.com</text>
            {layout.mode === 'LOCAL_FIXTURE' && <text x="7" y="56" fontSize="4.5" fontWeight="700">TEST FIXTURE · NOT A PRODUCTION LABEL</text>}
          </g><svg x="137" y="4" width="51.76" height="51.76" viewBox={`0 0 ${layout.qrSize} ${layout.qrSize}`} shapeRendering="crispEdges"><rect width={layout.qrSize} height={layout.qrSize} fill="white"/><path d={layout.qrPath} fill="black"/></svg>
        </svg></figure>
      </div>
      <p className={styles.caption}>Each face: 2.73 × 0.83 in. Print at 100% actual size with headers and footers off. The front keeps an 11 mm NFC reserve and a 9 mm placement guide. Confirm physical fit and QR readability before assembly.</p>
      <a className={styles.reportLink} href={layout.url} target="_blank" rel="noreferrer">Open approved report v{layout.approvalVersion}</a>
      {printError && <p className={styles.error} role="alert">{printError}</p>}
      <button type="button" onClick={print} disabled={printDisabled}>Print this saved label</button>
    </div>;
}
