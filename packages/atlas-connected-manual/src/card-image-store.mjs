import { canonical, digest, requireThat } from '@atlas/manual-service/contract';
import { completeUpload, parseDecodedFrame } from '@atlas/photo-core';
import { storedDocument, verification } from '@atlas/manual-intake/contract';
import { reportImageJobKey, reportImageRecipeHash } from './report-image-provider.mjs';

export async function recordCardImageIntent({ tx, principal, cardId, uploadId }) {
  await tx.$executeRawUnsafe(`INSERT INTO atlas_manual_connected.card_image_intent(upload_id,card_id,mode)
    VALUES($1::uuid,$2::uuid,$3) ON CONFLICT DO NOTHING`, uploadId, cardId, principal.mode);
}

export const currentCardImage = `EXISTS(SELECT 1 FROM atlas_manual_connected.card_image_binding cb
 JOIN atlas_manual_connected.card_image_intent ci ON ci.upload_id=cb.upload_id
 JOIN atlas_manual_intake.card c ON c.id=cb.card_id
 JOIN atlas_manual_intake.upload u ON u.card_id=c.id AND u.id=cb.upload_id
 WHERE cb.job_key=j.key AND ci.mode=j.mode AND u.source IS NOT NULL AND u.side=cb.side
 AND cb.original_sha256=u.plan::jsonb->'expected'->>'sha256'
 AND u.id=CASE WHEN cb.side='FRONT' THEN c.front_upload_id ELSE c.back_upload_id END
 AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d WHERE d.card_id=c.id))`;

/** Upload-bound admission shares the existing durable image-edit jobs. Old
 * publications remain readable; they no longer initiate a second image edit. */
export function createCardImageStore({ boundary, parsed }) {
  const machine = work => boundary.machineTransaction(null, work);
  return {
    photoIntent(cardId, uploadId, side) {
      return machine(async ({ tx, principal }) => (await tx.$queryRawUnsafe(`SELECT i.upload_id
        FROM atlas_manual_connected.card_image_intent i JOIN atlas_manual_intake.card c ON c.id=i.card_id
        JOIN atlas_manual_intake.upload u ON u.card_id=c.id AND u.id=i.upload_id
        WHERE i.card_id=$1::uuid AND i.upload_id=$2::uuid AND u.side=$3 AND i.mode=$4
        AND u.id=CASE WHEN u.side='FRONT' THEN c.front_upload_id ELSE c.back_upload_id END
        AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d WHERE d.card_id=c.id)`,
      cardId, uploadId, side, principal.mode)).length === 1);
    },
    photoCandidates(limit = 8) {
      requireThat(Number.isInteger(limit) && limit > 0 && limit <= 32, 500, 'REPORT_IMAGE_CONFIG_INVALID');
      return machine(({ tx, principal }) => tx.$queryRawUnsafe(`SELECT i.*,u.side,u.source,u.plan,u.verification
        FROM atlas_manual_connected.card_image_intent i JOIN atlas_manual_intake.card c ON c.id=i.card_id
        JOIN atlas_manual_intake.upload u ON u.card_id=c.id AND u.id=i.upload_id
        WHERE i.mode=$1 AND u.source IS NOT NULL
        AND u.id=CASE WHEN u.side='FRONT' THEN c.front_upload_id ELSE c.back_upload_id END
        AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d WHERE d.card_id=c.id)
        AND NOT EXISTS(SELECT 1 FROM atlas_manual_connected.card_image_binding b WHERE b.upload_id=i.upload_id)
        ORDER BY i.created_at,i.upload_id LIMIT $2`, principal.mode, limit));
    },
    async enqueuePhoto(upload, sourceMedia, recipe) {
      const sourceHash = sourceMedia.descriptor.raster.content.sha256;
      const originalHash = sourceMedia.original.content.sha256;
      const recipeHash = reportImageRecipeHash(recipe), sourceText = canonical(sourceMedia, { maxBytes: 32768 });
      const key = reportImageJobKey(sourceHash, recipe, upload.upload_id);
      requireThat(sourceMedia.original.uploadId === upload.upload_id && sourceMedia.original.binding.cardId === upload.card_id
        && sourceMedia.original.binding.side === upload.side, 503, 'REPORT_IMAGE_SOURCE_MISMATCH');
      parseDecodedFrame(sourceMedia.descriptor, sourceMedia.original, sourceMedia.decodePlan);
      requireThat(canonical(sourceMedia.descriptor) === canonical(sourceMedia.frame)
        && sourceMedia.descriptor.schemaVersion === 2 && sourceMedia.descriptor.treatment.colorSpace === 'sRGB'
        && sourceMedia.descriptor.treatment.bitDepth === 8 && sourceMedia.descriptor.treatment.channels === 3,
      503, 'REPORT_IMAGE_SOURCE_MISMATCH');
      return machine(async ({ tx, principal }) => {
        const [current] = await tx.$queryRawUnsafe(`SELECT u.id,u.plan,u.plan_hash,u.verification,u.verification_hash,u.source_hash FROM atlas_manual_intake.card c
          JOIN atlas_manual_intake.upload u ON u.card_id=c.id
          JOIN atlas_manual_connected.card_image_intent i ON i.upload_id=u.id
          WHERE c.id=$1::uuid AND u.id=$2::uuid AND i.mode=$3 AND u.side=$4 AND u.source=$5
          AND u.id=CASE WHEN u.side='FRONT' THEN c.front_upload_id ELSE c.back_upload_id END
          AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d WHERE d.card_id=c.id)
          FOR SHARE OF c`, upload.card_id, upload.upload_id, principal.mode, upload.side, upload.source);
        requireThat(current, 409, 'REPORT_IMAGE_SOURCE_CHANGED');
        const plan = storedDocument(current.plan, current.plan_hash);
        const observed = verification(storedDocument(current.verification, current.verification_hash), plan);
        completeUpload(plan, sourceMedia.original);
        requireThat(digest(upload.source) === current.source_hash
          && canonical(sourceMedia.original.object) === canonical(observed.object), 503, 'REPORT_IMAGE_SOURCE_MISMATCH');
        const [prior] = await tx.$queryRawUnsafe('SELECT job_key FROM atlas_manual_connected.card_image_binding WHERE upload_id=$1::uuid', upload.upload_id);
        if (prior) return prior.job_key;
        await tx.$executeRawUnsafe(`INSERT INTO atlas_manual_connected.report_image_job
          (key,source_hash,recipe_hash,recipe,mode,source_card_id,source_media,source_media_hash)
          VALUES($1,$2,$3,$4,$5,$6::uuid,$7,$8) ON CONFLICT DO NOTHING`,
        key, sourceHash, recipeHash, canonical(recipe), principal.mode, upload.card_id, sourceText, digest(sourceText));
        const selected = key;
        const [job] = await tx.$queryRawUnsafe('SELECT mode,source_hash,recipe_hash FROM atlas_manual_connected.report_image_job WHERE key=$1', selected);
        requireThat(job?.mode === principal.mode && job.recipe_hash === recipeHash
          && job.source_hash === sourceHash, 409, 'REPORT_IMAGE_CACHE_CONFLICT');
        await tx.$executeRawUnsafe(`INSERT INTO atlas_manual_connected.card_image_binding(upload_id,card_id,side,original_sha256,job_key)
          VALUES($1::uuid,$2::uuid,$3,$4,$5) ON CONFLICT DO NOTHING`, upload.upload_id, upload.card_id, upload.side, originalHash, selected);
        const [bound] = await tx.$queryRawUnsafe('SELECT job_key FROM atlas_manual_connected.card_image_binding WHERE upload_id=$1::uuid', upload.upload_id);
        return bound.job_key;
      });
    },
    photo(cardId, uploadId, side) {
      return machine(async ({ tx, principal }) => parsed((await tx.$queryRawUnsafe(`SELECT j.*,b.original_sha256 AS bound_original_sha256 FROM atlas_manual_connected.card_image_binding b
        JOIN atlas_manual_connected.report_image_job j ON j.key=b.job_key
        JOIN atlas_manual_intake.card c ON c.id=b.card_id
        JOIN atlas_manual_intake.upload u ON u.card_id=c.id AND u.id=b.upload_id AND u.side=b.side
        WHERE b.card_id=$1::uuid AND b.upload_id=$2::uuid AND b.side=$3 AND j.mode=$4
        AND b.upload_id=CASE WHEN b.side='FRONT' THEN c.front_upload_id ELSE c.back_upload_id END
        AND b.original_sha256=u.plan::jsonb->'expected'->>'sha256'
        AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d WHERE d.card_id=c.id)`,
      cardId, uploadId, side, principal.mode))[0]));
    },
    bindPhotoToPublication(publication, side, media) {
      requireThat(media.original.binding.cardId === publication.card_id && media.original.binding.side === side,
        503, 'REPORT_IMAGE_SOURCE_MISMATCH');
      const originalHash = media.original.content.sha256, reportHash = media.descriptor.raster.content.sha256;
      return machine(async ({ tx, principal }) => {
        const [current] = await tx.$queryRawUnsafe(`SELECT p.card_id FROM atlas_manual.publication p
          WHERE p.card_id=$1::uuid AND p.action_id=$2::uuid AND p.manifest_hash=$3 AND p.state='PUBLISHED' AND p.mode=$4
          AND NOT EXISTS(SELECT 1 FROM atlas_manual_intake.discarded_card d WHERE d.card_id=p.card_id)`,
        publication.card_id, publication.action_id, publication.manifest_hash, principal.mode);
        requireThat(current, 409, 'REPORT_IMAGE_PUBLICATION_CHANGED');
        const [photo] = await tx.$queryRawUnsafe(`SELECT b.job_key FROM atlas_manual_connected.card_image_binding b
          JOIN atlas_manual_connected.report_image_job j ON j.key=b.job_key
          WHERE b.card_id=$1::uuid AND b.side=$2 AND b.original_sha256=$3 AND j.mode=$4
          ORDER BY b.created_at DESC LIMIT 1`, publication.card_id, side, originalHash, principal.mode);
        if (!photo) return false;
        await tx.$executeRawUnsafe(`INSERT INTO atlas_manual_connected.report_image_binding
          (card_id,action_id,side,manifest_hash,job_key,report_source_hash,original_sha256)
          VALUES($1::uuid,$2::uuid,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
        publication.card_id, publication.action_id, side, publication.manifest_hash, photo.job_key, reportHash, originalHash);
        return true;
      });
    },
  };
}
