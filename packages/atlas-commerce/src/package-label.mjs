import { createHash } from 'node:crypto';
import { requireValue, UUID } from './contract.mjs';

/** A printable package identifier. Generating it is never print/custody proof. */
export function createPackageLabel(input) {
    requireValue(UUID.test(input.orderId??'') && /^ATLAS-[A-Z0-9-]+$/.test(input.reference??''),'PACKAGE_LABEL_INPUT_INVALID');
    requireValue(Number.isInteger(input.cardCount) && input.cardCount>0 && input.cardCount<=100,'PACKAGE_LABEL_INPUT_INVALID');
    const lines=['ATLAS GRADING',input.reference,`${input.cardCount} CARD${input.cardCount===1?'':'S'} - CUSTOMER SUBMISSION`,'Keep all cards together in this package.','Attach this label before using the dropbox.'];
    const content=lines.map((line,index)=>`BT /F1 ${index===1?19:11} Tf 22 ${258-index*34} Td (${line.replace(/[()\\]/g,'\\$&')}) Tj ET`).join('\n');
    const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 432 288] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`];
    let pdf='%PDF-1.4\n',offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
    const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('');
    pdf+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const bytes=Buffer.from(pdf);return {artifactKind:'ORDER_PACKAGE_LABEL',mimeType:'application/pdf',labelBase64:bytes.toString('base64'),
        labelSha256:createHash('sha256').update(bytes).digest('hex'),state:'GENERATED',printed:false};
}
