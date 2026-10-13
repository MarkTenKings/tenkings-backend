import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { publicationFixture } from '../../atlas-connected-manual/test/publication-fixture.mjs';
import { encodeSpeedsterTraceRleV1 } from '@atlas/grading-core/trace-codec';
import { calculateSpeedsterReview } from '@atlas/grading-core/review';
import { SPEEDSTER_RULE_VERSION } from '@atlas/grading-core/contracts';
import { measureSpeedsterCenteringBorders } from '@atlas/grading-core/scoring';
import { explainAtlasManualReport } from '@atlas/grading-core/manual-report';

// Authored rectangles, holes and abstract color blocks for UI qualification.
// No physical card, photograph, historical packet, grade or production ID is used.
const seed = await publicationFixture();
await seed.publication.publish({}, seed.cardId, seed.actionId);
const saved = JSON.parse(seed.row.manifest);
const base = await seed.artifacts.read(saved.packet.ref, { cardId: seed.cardId, kind: 'PUBLIC_REPORT', sourceHash: saved.packet.sourceHash });
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const crc32 = bytes => { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const name = Buffer.from(type), size = Buffer.alloc(4), crc = Buffer.alloc(4); size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([name, data]))); return Buffer.concat([size, name, data, crc]); };
function abstractImage(side) {
    const width = 1350, height = 1858, pixels = Buffer.alloc(height * (width * 3 + 1));
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const at = y * (width * 3 + 1) + 1 + x * 3, inside = x >= 40 && x < 1310 && y >= 40 && y < 1818;
        const tone = inside ? 195 + ((Math.floor(x / 90) + Math.floor(y / 90)) % 2) * 25 : 246;
        pixels[at] = tone; pixels[at + 1] = side === 'FRONT' ? tone - 8 : tone; pixels[at + 2] = tone - 15;
    }
    const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
    return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
export const syntheticImages = Object.fromEntries(['FRONT', 'BACK'].map(side => [side, abstractImage(side)]));
export const syntheticRectangles = [[200,200,5,6], [0,200,10,6], [600,600,15,15], [400,800,20,20], [1240,800,12,8], [400,1100,30,200], [500,1750,15,12]];
function finding(index, side, rectangle) {
    const [x, y, width, height] = rectangle, pixels = new Uint8Array(1270 * 1778);
    for (let row = y; row < y + height; row++) pixels.fill(1, row * 1270 + x, row * 1270 + x + width);
    if (index === 2) { pixels.fill(0, (y + 5) * 1270 + x + 5, (y + 5) * 1270 + x + 10); pixels[(y + height + 4) * 1270 + x + width + 4] = 1; }
    const trace = encodeSpeedsterTraceRleV1(pixels), value = structuredClone(base.report.findings[0]);
    Object.assign(value, { id: `${side}:synthetic-layout-${index}`, side, zone: ['EDGES','CORNERS','SURFACE'][index % 3], reviewResult: 'ACCEPTED',
        detectorMask: trace, canonicalContour: [{x:x/1269,y:y/1777},{x:(x+width)/1269,y:y/1777},{x:(x+width)/1269,y:(y+height)/1777},{x:x/1269,y:(y+height)/1777}] });
    if(!value.measurement)value.measurement=structuredClone(value.measurementRegions[0].measurement);
    const pixelCount=trace.runs.reduce((sum,run,i)=>sum+(i%2?run:0),0),areaMm2=pixelCount/400;
    value.measurement={...value.measurement,pixelCount,widthMm:(width+(index===2?5:0))/20,heightMm:(height+(index===2?5:0))/20,areaMm2,weightedAreaMm2:areaMm2,zonePercent:areaMm2/5000*100};
    delete value.measurementRegions; delete value.finalTrace; delete value.traceProvenance;
    return value;
}
export function syntheticPublicEntry(key = 'crowded') {
    const packet = structuredClone(base), report = packet.report;
    const count = key === 'empty' ? 0 : key === 'varied' ? 7 : 13;
    const findings = Array.from({ length: count }, (_, index) => finding(index,
        key === 'varied' && index < 3 ? 'FRONT' : 'BACK', key === 'varied' ? syntheticRectangles[index] : index===0?[0,0,8,12]:index===1?[0,600,9,13]:index===12?[650,600,160,200]:[120 + index * 55, 140 + index * 75, 8 + index, 12 + index]));
    const quad = [{ x:.05,y:.04 }, { x:.95,y:.04 }, { x:.95,y:.96 }, { x:.05,y:.96 }];
    const capture = Object.fromEntries(['front','back'].map(side=>[side,{centeringBorders:measureSpeedsterCenteringBorders(quad)}]));
    const reviewed = calculateSpeedsterReview(capture, findings);
    Object.assign(report, { identity: { playerName: `Synthetic ${key} UI fixture`, year:'2026', manufacturer:'Authored', productSet:'Test geometry only' },
        ruleVersion:SPEEDSTER_RULE_VERSION, grade:reviewed.grade, findings:reviewed.defects, finalGrade:Math.round(reviewed.grade.overall.rawGrade*2)/2,
        findingCounts:{total:count,included:count,removed:0,unreviewed:0} });
    for(const side of ['FRONT','BACK']) {
        const bytes=syntheticImages[side],sha256=digest(bytes);
        packet.images[side]={...packet.images[side],sha256,byteCount:bytes.length,contentType:'image/png'};
        report.inspection[side.toLowerCase()].imageSha256=sha256;
        packet.geometry[side].printedQuad=structuredClone(quad);
    }
    packet.reportNumber=`ATLAS-SYNTHETIC-${key.toUpperCase()}`;
    packet.publicToken='ar_'+({crowded:'C',varied:'V',empty:'E'}[key]).repeat(24);
    return {key,packet,publicHash:digest(JSON.stringify(packet)),explanation:explainAtlasManualReport(report),source:`/reports/${packet.publicToken}?v=1`};
}
