import { canonical, digest, requireBridge as check } from '@atlas/service-bridge/protocol';
import { parseOperatorImagePacket } from '@atlas/service-bridge/operator-images';

export function imageRecord(packet, asset) {
    parseOperatorImagePacket(packet,packet.request,asset);
    const { bytesBase64: _bytes, ...metadata } = packet;
    return { imageId: packet.imageId, canonical: canonical({ ...metadata, asset }), hash: digest(canonical({ ...metadata, asset })) };
}

/** Verify every actual image input against the generated image ledger. The
 * roster describes delivery bytes, not a claim that the model understood them. */
export function requestImageRoster(input, records) {
    const known = new Map(records.map(row => [row.imageId,row])), roster = [];
    for (const item of input) {
        const content = item.type === 'function_call_output' && Array.isArray(item.output) ? item.output : item.content;
        if (!Array.isArray(content)) continue;
        for (let index=0; index<content.length; index++) {
            const image = content[index];
            if (image.type !== 'input_image') continue;
            check(item.type === 'function_call_output' && index>0 && content[index-1].type === 'input_text', 'ASTRA_UNTRACKED_IMAGE');
            let marker; try { marker = JSON.parse(content[index-1].text); } catch { check(false,'ASTRA_UNTRACKED_IMAGE'); }
            const row = known.get(marker.imageId);
            check(marker.kind === 'ATLAS_TOOL_IMAGE_EVIDENCE' && row && digest(row.canonical) === row.hash, 'ASTRA_UNTRACKED_IMAGE');
            const record = JSON.parse(row.canonical), { asset, ...packet } = record;
            check(canonical(record) === row.canonical && image.detail === 'auto'
                && typeof image.image_url === 'string' && image.image_url.startsWith('data:image/png;base64,'), 'ASTRA_IMAGE_DELIVERY_CHANGED');
            packet.bytesBase64 = image.image_url.slice('data:image/png;base64,'.length);
            const { transform } = parseOperatorImagePacket(packet,packet.request,asset);
            const expected = { kind: 'ATLAS_TOOL_IMAGE_EVIDENCE', imageId: packet.imageId, sourceAssetId: asset.assetId,
                side: asset.side, sourceView: asset.view, sourceSha256: asset.sha256, sha256: packet.sha256,
                byteCount: packet.byteCount, width: packet.width, height: packet.height, transformHash: packet.transformHash,
                coordinateFrame: transform.coordinateFrame, sourceRect: transform.rect, purpose: packet.request.purpose, detail: 'auto' };
            check(canonical(marker) === canonical(expected) && !roster.some(r => r.imageId === packet.imageId), 'ASTRA_IMAGE_DELIVERY_CHANGED');
            roster.push({ imageId: packet.imageId, imageHash: packet.sha256, lineageHash: row.hash, callId: item.call_id });
        }
    }
    check(roster.length === records.length, 'ASTRA_IMAGE_DELIVERY_INCOMPLETE');
    return roster;
}
