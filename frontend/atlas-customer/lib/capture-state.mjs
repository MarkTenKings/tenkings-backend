/** A locally captured pair may not have reached the server yet. Count the union
 * of immutable card IDs so resuming a remote draft cannot hide a new capture. */
export function captureCounts(draft, local) {
  const server = new Map((draft?.cards ?? []).map(card => [card.id, card]));
  const localIds = new Set((local?.pairs ?? []).map(pair => pair.cardId));
  const ids = new Set([...server.keys(), ...localIds]);
  const verified = [...server.values()].filter(card => ['FRONT', 'BACK'].every(side => card.uploads?.[side]?.state === 'VERIFIED'));
  return {
    count: ids.size,
    uploadedCount: verified.length,
    waitingCount: ids.size - verified.length,
    ready: ids.size > 0 && ids.size === server.size && verified.length === server.size && [...server.values()].every(card => Boolean(card.identity)),
  };
}

/** Resolve the saved destination before any creation. A failed read of an
 * existing draft never permits replacing it with a new empty draft. */
export async function connectCapturedDraft({ buffer, request }) {
  const saved = await buffer.snapshot();
  if (saved.draftId) {
    const result = await request(`/intake/drafts/${saved.draftId}`);
    if (result?.draft?.id !== saved.draftId) throw Object.assign(Error('Saved submission could not be confirmed.'), { code: 'DRAFT_MISMATCH' });
    return result.draft;
  }
  const creation = await buffer.creation();
  if (creation.intakeMethod === 'DEALER_DROP_OFF' && !creation.kioskId) return null;
  const result = await request('/intake/drafts', { body: creation });
  await buffer.attachDraft(result.draft.id);
  return result.draft;
}

/** Payment can finish in a different tab while this device owns another camera
 * draft. Never clear originals that do not belong to the paid submission. */
export async function clearPaidCapture(buffer, draftId) {
  if (!buffer || !draftId) return false;
  const current = await buffer.snapshot();
  if (current.draftId !== draftId) return false;
  await buffer.clearPaid();
  return true;
}
