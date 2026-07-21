const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const test = require('node:test');
const sharp = require('sharp');

const { MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST } = require('../../shared/dist');
const {
  FIXED_RIG_AUTOMATIC_DESIGN_REGISTRATION_V1_VERSION,
  buildFixedRigAutomaticDesignRegistrationV1,
} = require('../dist/drivers/fixedRigAutomaticDesignRegistrationV1');

const WIDTH = 300;
const HEIGHT = 420;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function referenceRaster(seed, mode = 'unique') {
  const raw = Buffer.alloc(WIDTH * HEIGHT);
  let state = seed >>> 0;
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      let value;
      if (mode === 'flat') {
        value = 128;
      } else if (mode === 'repeated') {
        value = (((x % 24) < 12) !== ((y % 24) < 12)) ? 210 : 45;
      } else {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        value = 45 + ((state >>> 24) % 166);
      }
      raw[y * WIDTH + x] = value;
    }
  }
  const sigma = mode === 'unique' ? 1.15 : 0.75;
  const blurred = await sharp(raw, { raw: { width: WIDTH, height: HEIGHT, channels: 1 } })
    .blur(sigma)
    .greyscale()
    .raw()
    .toBuffer();
  const png = await sharp(blurred, { raw: { width: WIDTH, height: HEIGHT, channels: 1 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return { raw: blurred, png };
}

function centeredAffine({ scale = 1, rotationDegrees = 0, shiftX = 0, shiftY = 0 }) {
  const angle = rotationDegrees * Math.PI / 180;
  const a = scale * Math.cos(angle);
  const b = -scale * Math.sin(angle);
  const c = scale * Math.sin(angle);
  const d = scale * Math.cos(angle);
  const centerX = (WIDTH - 1) / 2;
  const centerY = (HEIGHT - 1) / 2;
  return [
    a,
    b,
    shiftX + centerX - a * centerX - b * centerY,
    c,
    d,
    shiftY + centerY - c * centerX - d * centerY,
  ];
}

function bilinear(raw, x, y) {
  if (x < 0 || y < 0 || x >= WIDTH - 1 || y >= HEIGHT - 1) return 128;
  const left = Math.floor(x);
  const top = Math.floor(y);
  const dx = x - left;
  const dy = y - top;
  const at = (px, py) => raw[py * WIDTH + px];
  return at(left, top) * (1 - dx) * (1 - dy) +
    at(left + 1, top) * dx * (1 - dy) +
    at(left, top + 1) * (1 - dx) * dy +
    at(left + 1, top + 1) * dx * dy;
}

async function transformedRaster(referenceRaw, matrix, options = {}) {
  const [a, b, tx, c, d, ty] = matrix;
  const determinant = a * d - b * c;
  const source = Buffer.alloc(WIDTH * HEIGHT);
  let noiseState = 0x5a17c9e3;
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const shiftedX = x - tx;
      const shiftedY = y - ty;
      const referenceX = (d * shiftedX - b * shiftedY) / determinant;
      const referenceY = (-c * shiftedX + a * shiftedY) / determinant;
      noiseState = (Math.imul(noiseState, 1103515245) + 12345) >>> 0;
      const noise = options.noiseAmplitude
        ? (((noiseState >>> 24) / 255) * 2 - 1) * options.noiseAmplitude
        : 0;
      const gain = (options.gain ?? 1) + (options.horizontalGainRamp ?? 0) * x / WIDTH;
      const value = bilinear(referenceRaw, referenceX, referenceY) * gain +
        (options.offset ?? 0) + noise;
      source[y * WIDTH + x] = Math.max(0, Math.min(255, Math.round(value)));
    }
  }
  const pipeline = sharp(source, { raw: { width: WIDTH, height: HEIGHT, channels: 1 } });
  const processed = options.blurSigma
    ? await pipeline.blur(options.blurSigma).greyscale().raw().toBuffer()
    : source;
  return sharp(processed, { raw: { width: WIDTH, height: HEIGHT, channels: 1 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

function buildInput(referencePng, sourcePng) {
  const artifactSha256 = sha256(referencePng);
  return {
    approvedReference: {
      referenceId: 'approved-design-front-v1',
      profile: 'registered_design_template_v1',
      status: 'approved',
      tenantId: 'tenant-1',
      setId: 'set-1',
      programId: 'program-1',
      cardNumber: '42',
      variantId: 'base',
      parallelId: 'none',
      side: 'front',
      version: 1,
      artifactSha256,
      artifactWidthPx: WIDTH,
      artifactHeightPx: HEIGHT,
      intendedDesignBoundary: {
        schemaVersion: 'ai-grader-intended-design-boundary-v1',
        coordinateFrame: 'design_reference_pixels',
        contour: [[18, 24], [282, 24], [282, 396], [18, 396]],
      },
      approvedByUserId: 'approver-1',
      approvedAt: '2026-07-18T18:00:00.000Z',
    },
    artifactEvidence: {
      assetId: 'approved-reference-raster',
      sha256: artifactSha256,
      bytes: referencePng,
    },
    normalizedSourceEvidence: {
      assetId: 'normalized-front-source',
      sha256: sha256(sourcePng),
      bytes: sourcePng,
      side: 'front',
      coordinateFrame: 'normalized_card_portrait_pixels',
      widthPx: WIDTH,
      heightPx: HEIGHT,
    },
    measurementCalibration: {
      pixelsPerMmX: WIDTH / 63.5,
      pixelsPerMmY: HEIGHT / 88.9,
    },
  };
}

test('scale-aware search and subpixel refinement register a physical-like shifted affine raster', async () => {
  const reference = await referenceRaster(0x7b31d9a5);
  const expected = centeredAffine({
    scale: 1.002,
    rotationDegrees: 0.7,
    shiftX: 22.35,
    shiftY: -18.6,
  });
  const source = await transformedRaster(reference.raw, expected, {
    gain: 0.88,
    horizontalGainRamp: 0.16,
    offset: 8,
    noiseAmplitude: 2.5,
    blurSigma: 0.45,
  });
  const result = await buildFixedRigAutomaticDesignRegistrationV1(buildInput(reference.png, source));
  assert.equal(result.status, 'computed', result.reasons?.join('; '));
  assert.equal(result.algorithmVersion, FIXED_RIG_AUTOMATIC_DESIGN_REGISTRATION_V1_VERSION);
  assert.ok(result.correspondences.length >= 24);
  assert.ok(result.correspondences.some((entry) =>
    !Number.isInteger(entry.normalizedSourcePointPx.x) ||
    !Number.isInteger(entry.normalizedSourcePointPx.y)));
  expected.forEach((value, index) => {
    assert.ok(Math.abs(result.projection.registration.transformMatrix[index] - value) < 0.8);
  });
  assert.ok(result.projection.registration.registrationResidualPx <= 1);
  assert.ok(result.projection.registration.confidence >= 0.8);
  assert.equal(
    MATHEMATICAL_GRADING_V1_THRESHOLD_MANIFEST.centering.registeredDesignTemplate
      .automaticRegistration.maximumSupportedTranslationMm,
    6.35,
  );
});

test('automatic registration rejects repeated texture, low texture, and the wrong exact reference', async () => {
  const unique = await referenceRaster(0xa61fc043);
  const different = await referenceRaster(0x13ac5e79);
  const repeated = await referenceRaster(1, 'repeated');
  const flat = await referenceRaster(1, 'flat');
  const identityUnique = await transformedRaster(unique.raw, centeredAffine({ shiftX: 4.2, shiftY: -3.7 }));
  const identityRepeated = await transformedRaster(repeated.raw, centeredAffine({ shiftX: 4, shiftY: 4 }));
  const identityFlat = await transformedRaster(flat.raw, centeredAffine({}));
  const cases = [
    buildInput(repeated.png, identityRepeated),
    buildInput(flat.png, identityFlat),
    buildInput(different.png, identityUnique),
  ];
  for (const input of cases) {
    const result = await buildFixedRigAutomaticDesignRegistrationV1(input);
    assert.equal(result.status, 'insufficient_evidence');
    assert.equal(result.cardDefectDeduction, 0);
  }
});

test('automatic registration fails closed without finalized scale authority', async () => {
  const reference = await referenceRaster(0x4429fe81);
  const source = await transformedRaster(reference.raw, centeredAffine({}));
  const input = buildInput(reference.png, source);
  input.measurementCalibration.pixelsPerMmX = 0;
  const result = await buildFixedRigAutomaticDesignRegistrationV1(input);
  assert.equal(result.status, 'insufficient_evidence');
  assert.match(result.reasons.join(' '), /pixel\/mm calibration/);
});
