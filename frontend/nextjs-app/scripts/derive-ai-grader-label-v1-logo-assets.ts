import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const SOURCE_SHA256 = "c7461cc51eefdf5c259c9895eca1ceab870865c660988273cc8241c1ea8ae470";
const DARK_BLACK = 15;

function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function monochromePng(input: Buffer, extract?: { left: number; top: number; width: number; height: number }) {
  let pipeline = sharp(input).ensureAlpha();
  if (extract) pipeline = pipeline.extract(extract);
  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = DARK_BLACK;
    data[offset + 1] = DARK_BLACK;
    data[offset + 2] = DARK_BLACK;
  }
  return sharp(data, { raw: info }).png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer();
}

async function main() {
  const assetDir = path.resolve(process.cwd(), "assets", "ai-grader-label-v1");
  const sourcePath = path.join(assetDir, "ten-kings-logo-2026-v1.png");
  const source = readFileSync(sourcePath);
  if (sha256(source) !== SOURCE_SHA256) throw new Error("Ten Kings source logo hash mismatch.");

  const logo = await monochromePng(source);
  const crown = await monochromePng(source, { left: 147, top: 25, width: 1206, height: 784 });
  const logoPath = path.join(assetDir, "ten-kings-logo-2026-monochrome-v1.png");
  const crownPath = path.join(assetDir, "ten-kings-crown-2026-monochrome-v1.png");
  await sharp(logo).toFile(logoPath);
  await sharp(crown).toFile(crownPath);

  process.stdout.write(
    `${JSON.stringify(
      {
        sourceSha256: SOURCE_SHA256,
        color: "#0f0f0f",
        logo: { fileName: path.basename(logoPath), widthPx: 1500, heightPx: 1170, sha256: sha256(readFileSync(logoPath)) },
        crown: { fileName: path.basename(crownPath), widthPx: 1206, heightPx: 784, sha256: sha256(readFileSync(crownPath)) },
      },
      null,
      2
    )}\n`
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
