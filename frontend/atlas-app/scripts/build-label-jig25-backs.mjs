// Build the reusable back downloads using the same bounded production renderer.
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { renderApprovedBBack, approvedBHash } from '../../../packages/atlas-finishing/src/label-approved-b-artwork.mjs';
import { LABEL_JIG_25, LABEL_25_PROFILE_DEFINITIONS } from '../../../packages/atlas-finishing/src/label-sheet-25.mjs';
import { renderLabelSheetPng } from '../../../packages/atlas-finishing/src/label-sheet.mjs';

const directory = new URL('../assets/label-templates/', import.meta.url);
await mkdir(directory, { recursive: true });
const printSvg = renderApprovedBBack(), artworkHash = approvedBHash(printSvg), outputs = [];
for (const [name, mode, previewMaterial] of [['black', 'black-ink-transparent', 'gold'], ['gold', 'color', 'gold'], ['silver', 'color', 'holo']]) {
  const profile = LABEL_25_PROFILE_DEFINITIONS.find(value => value.page === 1 && value.side === 'BACK' && value.mode === mode);
  const items = LABEL_JIG_25.slots.map(({ slot }) => ({ slot, printSvg, artworkHash, previewMaterial }));
  const result = await renderLabelSheetPng(items, { exportProfileId: profile.id });
  const filename = `atlas-25-back-${name}.png`;
  await writeFile(new URL(filename, directory), result.bytes);
  outputs.push({ filename, stock: previewMaterial, ...result.manifest });
  process.stdout.write(`${filename}: ${result.sha256}, ${result.manifest.rasterReceipt.elapsedMs} ms\n`);
}
await writeFile(new URL('atlas-25-backs-manifest.json', directory), JSON.stringify({
  version: 'atlas-reusable-25-backs-v1', jigHash: LABEL_JIG_25.jigHash, artworkHash, outputs,
}, null, 2) + '\n');
process.stdout.write(`Saved ${fileURLToPath(directory)}\n`);
