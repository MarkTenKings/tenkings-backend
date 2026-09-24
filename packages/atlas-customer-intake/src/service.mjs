import { ownedUpload, requireThat, canonical, digest } from './contract.mjs';
import { processedPhoto } from '@atlas/manual-intake/contract';

/** Storage verification is customer-owned and server observed. The browser can
 * never submit verification, model output, preparation or a paid-effect result. */
export function createCustomerIntakeService({ repository, storage, processPhoto, identify, uploadExpiresIn = 300 }) {
  requireThat(repository && storage && typeof processPhoto === 'function' && typeof identify === 'function', 500, 'INTAKE_CONFIGURATION_REQUIRED');
  async function current(authority, input) { return ownedUpload((await repository.upload(authority, input)).upload); }
  function observed(found, upload) {
    requireThat(found.object?.key === upload.plan.object.key && found.sha256 === upload.plan.expected.sha256 && found.byteCount === upload.plan.expected.byteCount
      && found.contentType === 'application/octet-stream', 409, 'INTAKE_UPLOAD_CONFLICT');
    return { object: found.object, sha256: found.sha256, byteCount: found.byteCount, contentType: found.contentType };
  }
  return Object.freeze({
    async sign(authority, input) {
      const upload = await current(authority, input);
      if (upload.verification) return { state: 'VERIFIED' };
      const signed = await storage.createOriginalUpload({ uploadPlan: upload.plan, expiresIn: uploadExpiresIn });
      await current(authority, input);
      return { state: 'UPLOAD', ...signed };
    },
    async complete(authority, input) {
      const upload = await current(authority, input);
      if (upload.verification) return repository.verify(authority, { ...input, verification: upload.verification });
      const found = await storage.readOriginal({ uploadPlan: upload.plan });
      const verification = observed(found, upload);
      await current(authority, input);
      return repository.verify(authority, { ...input, verification });
    },
    /** A host worker calls this independently of a browser lifetime. Paid
     * effects reserve before dispatch; an uncertain reply is never repeated. */
    async runOnce() {
      const { job } = await repository.claim(); if (!job) return { worked: false };
      const scope = { attemptId: job.attemptId, leaseId: job.leaseId };
      try {
        const photos = {};
        for (const side of ['FRONT', 'BACK']) {
          const upload = ownedUpload(job.uploads[side]);
          requireThat(upload.verification, 409, 'INTAKE_PAIR_NOT_READY');
          const found = await storage.readOriginal({ uploadPlan: upload.plan, object: upload.verification.object });
          requireThat(canonical(observed(found, upload)) === canonical(upload.verification), 409, 'INTAKE_UPLOAD_CONFLICT');
          const photo = processedPhoto(upload.prepared ?? await processPhoto({ uploadPlan: upload.plan, verification: upload.verification, bytes: found.bytes }), upload.plan, upload.verification);
          await repository.prepared({ ...scope, uploadId: upload.plan.uploadId, photo }); photos[side] = photo;
        }
        let uncertain = false;
        const effect = async (stage, request, dispatch) => {
          requireThat(!uncertain, 409, 'IDENTIFICATION_OUTCOME_UNKNOWN');
          const requestHash = digest(canonical(request));
          const saved = await repository.dispatch({ ...scope, stage, requestHash });
          if (saved.response) return Buffer.from(saved.response, 'base64');
          requireThat(saved.dispatch === true, 409, 'IDENTIFICATION_OUTCOME_UNKNOWN');
          try {
            const bytes = await dispatch();
            requireThat(bytes instanceof Uint8Array && bytes.length > 0 && bytes.length <= 262144, 503, 'IDENTIFICATION_REPLY_INVALID');
            await repository.response({ ...scope, stage, requestHash, response: Buffer.from(bytes).toString('base64'), responseHash: digest(bytes) });
            return bytes;
          } catch (error) { uncertain = true; throw error; }
        };
        const result = await identify({ accountId: job.accountId, cardId: job.cardId, sourceHash: job.sourceHash, photos, effect });
        requireThat(!uncertain, 409, 'IDENTIFICATION_OUTCOME_UNKNOWN');
        await repository.finish({ ...scope, result }); return { worked: true, cardId: job.cardId };
      } catch (error) {
        await repository.fail({ ...scope, code: /^[A-Z_]{3,90}$/.test(error?.code ?? '') ? error.code : 'IDENTIFICATION_NEEDS_ATTENTION' });
        return { worked: true, cardId: job.cardId, attention: true };
      }
    },
  });
}
