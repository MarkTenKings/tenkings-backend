import { createHash } from 'node:crypto';
import { researchCardSubject, StaffInventoryResearchError } from './engine.mjs';
import { LegacyInventoryResearchInputSchema, LegacyInventoryResearchResultSchema } from './contract.mjs';
export * from './engine.mjs';
export * from './contract.mjs';
export { LegacyInventoryResearchInputSchema as StaffInventoryResearchInputSchema, LegacyInventoryResearchResultSchema as StaffInventoryResearchResultSchema } from './contract.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');

/** Compatibility boundary for an Inventory host adopting this package. Its
 * existing authorized photo reader and optional recovery validator are injected;
 * no Inventory persistence, keys, worker or ambient environment is imported. */
export async function researchStaffInventoryCard(input, deps = {}, signal) {
  const parsed = LegacyInventoryResearchInputSchema.safeParse(input);
  if (!parsed.success) throw new StaffInventoryResearchError('invalid_input');
  let data = parsed.data;
  if (deps.recoveryAssessment) {
    if (typeof deps.applyRecoveryContext !== 'function') throw new StaffInventoryResearchError('invalid_input');
    data = LegacyInventoryResearchInputSchema.parse(deps.applyRecoveryContext(data, deps.recoveryAssessment));
  }
  const photos = {}, keys = new Map();
  for (const side of ['front','back']) {
    const key = data[`${side}_photo_key`];
    if (!key) { photos[side] = null; continue; }
    const sha256 = key.slice(key.lastIndexOf('/') + 1, -4), ref = `inventory-${side}-${sha256}`;
    photos[side] = {ref,sha256,sourceSha256:sha256,mimeType:'image/jpeg',byteCount:null};
    keys.set(ref,key);
  }
  const result = await researchCardSubject({schema_version:1,subject:{namespace:'inventory',id:hash(data.unit_id),revision:hash(JSON.stringify(data))},description:data.description,photos}, {
    ...deps, recoveryContextApplied:Boolean(deps.recoveryAssessment),
    loadPhoto:async (descriptor,signal) => {
      const key=keys.get(descriptor.ref),photo=await deps.loadPhoto?.(key,signal);
      if (!photo || photo.key!==key) throw new StaffInventoryResearchError('unverified_photo');
      return {...descriptor,sha256:photo.sha256,bytes:photo.bytes};
    },
  },signal);
  const {subject:ignored,...rest}=result;
  return LegacyInventoryResearchResultSchema.parse({schema_version:rest.schema_version,unit_id:input.unit_id,description_event_id:input.description_event_id,description_hash:input.description_hash,...rest,
    photos:Object.fromEntries(['front','back'].map(side=>[side,result.photos[side]?{key:input[`${side}_photo_key`],sha256:result.photos[side].sha256}:null]))});
}
