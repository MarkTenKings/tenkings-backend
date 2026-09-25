import { canonical, document, immutable, photoSourceHash, processedPhoto, requireThat, verification } from './contract.mjs';

/** Durable host boundary. All storage/decoder/artifact effects occur between
 * authenticated repository transactions; each subsequent commit reauthorizes.
 * The verifier stores untouched originals before attempting any decoder.
 */
export { processedPhoto } from './contract.mjs';
export function createManualIntake({ repository, storage, artifacts, processPhoto, sourcePrepared = null, uploadExpiresIn = 300 }) {
  requireThat(repository && storage && artifacts && Number.isInteger(uploadExpiresIn) && uploadExpiresIn > 0
    && uploadExpiresIn <= 3600, 500, 'INTAKE_CONFIG_INVALID');
  const readSource = async (staff, cardId, uploadId, options = {}) => {
    const { upload } = await repository.upload(staff, cardId, uploadId);
    requireThat(upload.verification && upload.source, 409, 'INTAKE_PHOTO_NOT_PREPARED');
    const sourceHash = photoSourceHash(upload);
    requireThat(upload.source.photoSourceHash === sourceHash, 503, 'INTAKE_STORED_CONTENT_INVALID');
    const source = await artifacts.read(upload.source.ref, { cardId, kind: 'PHOTO_SOURCE', sourceHash }, options);
    const checked = processedPhoto(source, upload.plan, upload.verification);
    // Auth can expire while reading a large artifact; refuse the result then.
    await repository.upload(staff, cardId, uploadId);
    return { upload, photo: checked };
  };
  return Object.freeze({
    discard: (staff, input) => repository.discard(staff, input),
    discardStatus: (staff, input) => repository.discardStatus(staff, input),
    create: (staff, input) => repository.create(staff, input),
    list: (staff, options) => repository.list(staff, options),
    processingList: (staff, options) => repository.processingList(staff, options),
    read: async (staff, cardId) => ({ card: (await repository.read(staff, cardId)).card }),
    plan: (staff, cardId, input) => repository.plan(staff, cardId, input),
    upload: async (staff, cardId, uploadId) => {
      const { card, upload } = await repository.upload(staff, cardId, uploadId); return { card, upload };
    },
    async sign(staff, cardId, uploadId, { signal } = {}) {
      const { upload } = await repository.upload(staff, cardId, uploadId, { edit: true, current: true });
      if (upload.verification) return { state: 'VERIFIED', upload };
      const signed = await storage.createOriginalUpload({ uploadPlan: upload.plan, expiresIn: uploadExpiresIn, signal });
      // A replaced plan cannot mint a fresh usable URL from a late sign reply.
      await repository.upload(staff, cardId, uploadId, { edit: true, current: true });
      return { state: 'UPLOAD', ...signed };
    },
    async complete(staff, cardId, uploadId, { signal, lease = null } = {}) {
      const { upload } = await repository.upload(staff, cardId, uploadId, { edit: true, lease });
      // A lost committed reply returns its exact durable receipt. No HEAD of a
      // later version can rewrite which object was originally accepted.
      if (upload.verification) return { card: (await repository.read(staff, cardId)).card, upload };
      let found;
      try { found = await storage.readOriginal({ uploadPlan: upload.plan, signal }); }
      catch (error) {
        if (error?.code === 'PHOTO_OBJECT_NOT_FOUND') requireThat(false, 409, 'INTAKE_UPLOAD_ABSENT');
        throw error;
      }
      const observed = verification({ object: found.object, sha256: found.sha256, byteCount: found.byteCount, contentType: found.contentType }, upload.plan);
      signal?.throwIfAborted();
      return repository.recordVerification(staff, cardId, uploadId, observed, { lease });
    },
    async prepare(staff, cardId, uploadId, { signal, lease = null } = {}) {
      requireThat(typeof processPhoto === 'function', 503, 'INTAKE_PHOTO_PROCESSOR_UNAVAILABLE');
      let { upload } = await repository.upload(staff, cardId, uploadId, { edit: true, current: true, lease });
      if (!upload.verification) ({ upload } = await this.complete(staff, cardId, uploadId, { signal, lease }));
      if (upload.source) {
        // Replay the exact source through the same atomic intent/admission
        // hooks. A prepared pair remains recoverable after process replacement.
        if (!lease) await readSource(staff, cardId, uploadId, { signal });
        signal?.throwIfAborted();
        const result = await repository.recordSource(staff, cardId, uploadId, {
          verificationHash: document(upload.verification).hash, source: upload.source }, { lease });
        if (sourcePrepared && !lease) await sourcePrepared(staff, cardId, uploadId);
        return result;
      }
      const found = await storage.readOriginal({ uploadPlan: upload.plan, object: upload.verification.object, signal });
      requireThat(canonical(verification({ object: found.object, sha256: found.sha256, byteCount: found.byteCount,
        contentType: found.contentType }, upload.plan)) === canonical(upload.verification), 409, 'INTAKE_UPLOAD_CONFLICT');
      const processed = processedPhoto(await processPhoto({ uploadPlan: upload.plan, verification: upload.verification,
        bytes: found.bytes, signal }), upload.plan, upload.verification);
      signal?.throwIfAborted();
      const sourceHash = photoSourceHash(upload), ref = await artifacts.write(processed, { cardId, kind: 'PHOTO_SOURCE', sourceHash }, { signal });
      // Late successful work may be retained as historical evidence, but cannot
      // replace a newer selected side. Current pair readiness uses selected IDs.
      signal?.throwIfAborted();
      const result = await repository.recordSource(staff, cardId, uploadId, { verificationHash: document(upload.verification).hash,
        source: { photoSourceHash: sourceHash, ref } }, { lease });
      // Machine source/geometry/pair intents committed above. An optional wake
      // failing afterward must not recast that durable success as attention.
      if (sourcePrepared && !lease) await sourcePrepared(staff, cardId, uploadId);
      return result;
    },
    readSource,
    async verifiedPair(staff, cardId, options = {}) {
      const { card, principal } = await repository.read(staff, cardId, { edit: true });
      requireThat(card.ready, 409, 'INTAKE_PAIR_NOT_READY');
      const front = await readSource(staff, cardId, card.sides.FRONT.upload.uploadId, options);
      const back = await readSource(staff, cardId, card.sides.BACK.upload.uploadId, options);
      const current = (await repository.read(staff, cardId, { edit: true })).card;
      requireThat(current.sourceHash === card.sourceHash, 409, 'INTAKE_PAIR_STALE');
      return immutable({ cardId, pairId: card.pairId, sourceHash: card.sourceHash, principal,
        sides: { FRONT: front, BACK: back } });
    },
  });
}
