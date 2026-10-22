import { createHash } from 'node:crypto';
import { parsePublicManualReport } from '../../../../packages/atlas-report-view/src/manual-public-contract.mjs';
import { COLLECTION_DISPLAY_LIMITS as LIMITS, collectionDisplayBinding, displayBindingKey, assertDisplayBinding, displayCheck, displayError,
  displayFrontPath, parseCollectionDisplay, verifyDisplayWebp } from '../collection-display-contract.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const exactMethods = (v, names) => v && Object.keys(v).length === names.length && names.every(n => typeof v[n] === 'function');
const title = identity => [identity.playerName ?? identity.cardName, identity.year, identity.manufacturer, identity.productSet,
  identity.parallel, identity.insert, identity.cardNumber ? `#${identity.cardNumber}` : null].filter(v => typeof v === 'string' && v.trim()).join(' · ').slice(0,500).trim() || 'Graded card';

/** Inert trusted composition only. No client creation, environment, DB, storage,
 * provider, staff label or grading runtime. approvedReader is separately
 * authorized to read exact saved publications; it cannot establish ownership.
 * It must enforce maxBytes/signal during I/O, not buffer an unbounded object.
 * reportHash belongs to the original private approval, not the redacted report;
 * it is preserved inside the exact public packet hash, never recomputed here. */
export function createCollectionDisplayService({ ownershipRead, approvedReader, mode } = {}) {
  displayCheck(exactMethods(ownershipRead, ['read']) && exactMethods(approvedReader, ['readReport','readImage']) && ['PRODUCTION','LOCAL_FIXTURE'].includes(mode));
  const read = ownershipRead.read, readReport = approvedReader.readReport, readImage = approvedReader.readImage;
  let active = 0;
  const current = () => displayCheck(exactMethods(ownershipRead,['read']) && ownershipRead.read === read
    && exactMethods(approvedReader,['readReport','readImage']) && approvedReader.readReport === readReport && approvedReader.readImage === readImage);
  async function owner(cookie, cardId, signal) {
    signal.throwIfAborted(); current(); let card;
    try { card = await read.call(ownershipRead,cookie,'read_card',{cardId}); }
    catch(error) { if([401,403,404].includes(error?.status)||['SIGN_IN_REQUIRED','OWNERSHIP_NOT_FOUND','CUSTOMER_ACCESS_NOT_ENABLED'].includes(error?.code))throw displayError('COLLECTION_DISPLAY_ACCESS_ENDED',403); throw error; }
    signal.throwIfAborted(); current();
    displayCheck(card?.cardId === cardId, 'COLLECTION_DISPLAY_ACCESS_ENDED', 403);
    return collectionDisplayBinding(card,card.ownership?.ownerAccountId);
  }
  async function packet(binding, signal) {
    signal.throwIfAborted(); current();
    const value = await readReport.call(approvedReader,{ token: binding.report.publicToken, version: binding.report.version, signal, maxBytes: LIMITS.packetBytes });
    signal.throwIfAborted(); current();
    displayCheck(value && typeof value.publicHash === 'string' && value.publicHash === binding.report.publicHash);
    const bytes = JSON.stringify(value.packet);
    displayCheck(typeof bytes === 'string' && Buffer.byteLength(bytes) <= LIMITS.packetBytes && sha(bytes) === binding.report.publicHash);
    const p = parsePublicManualReport(value.packet);
    displayCheck(sha(JSON.stringify(p)) === binding.report.publicHash && p.publicToken === binding.report.publicToken
      && p.approvalVersion === binding.report.version && p.reportNumber === binding.certificateNumber && p.mode === mode);
    return p;
  }
  async function bounded(fn, signal) {
    current(); displayCheck(active < LIMITS.concurrent); active++;
    const combined = signal ? AbortSignal.any([signal,AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000);
    // Keep the capacity slot until the trusted I/O settles, even after a caller
    // times out. Late work can never publish a result or free unlimited slots.
    let abort;
    const work = Promise.resolve().then(() => { combined.throwIfAborted(); return fn(combined); }).finally(() => { active--; });
    const cancelled = new Promise((_,reject) => { abort = () => reject(displayError()); combined.addEventListener('abort',abort,{once:true}); if(combined.aborted) abort(); });
    try { return await Promise.race([work,cancelled]); } finally { combined.removeEventListener('abort',abort); }
  }
  async function snapshot(cookie,cardId,signal) {
    const binding = await owner(cookie,cardId,signal), p = await packet(binding,signal);
    assertDisplayBinding(await owner(cookie,cardId,signal),binding); signal.throwIfAborted();
    const front = p.images.FRONT, available = front.byteCount <= LIMITS.imageBytes;
    return parseCollectionDisplay({schema:'atlas-collection-display-v1',binding,title:title(p.report.identity),finalGrade:p.report.finalGrade,
      front:{status:available?'AVAILABLE':'EXCEEDS_DISPLAY_LIMIT',provenance:'APPROVED_GRADING_PHOTOGRAPH',...front,path:available?displayFrontPath(binding):null}},binding);
  }
  return Object.freeze({ mode,
    readDisplay(cookie,cardId,{signal}={}) { return bounded(s => snapshot(cookie,cardId,s),signal); },
    readFront(cookie,cardId,expected,{signal}={}) { return bounded(async s => {
      const before = await snapshot(cookie,cardId,s);
      displayCheck(before.binding.ownershipRevision === expected.ownershipRevision && before.binding.approvalActionId === expected.approvalActionId
        && before.binding.report.version === expected.version && before.binding.report.publicHash === expected.publicHash,'COLLECTION_DISPLAY_ACCESS_ENDED',403);
      displayCheck(before.front.status === 'AVAILABLE');
      s.throwIfAborted(); current();
      const photo = await readImage.call(approvedReader,{token:before.binding.report.publicToken,version:before.binding.report.version,side:'FRONT',signal:s,maxBytes:LIMITS.imageBytes});
      s.throwIfAborted(); current();
      displayCheck(photo?.bytes instanceof Uint8Array && photo.bytes.byteLength <= LIMITS.imageBytes && photo.contentType === before.front.contentType);
      // Copy once: an injected reader cannot mutate the checked output later.
      const bytes = Buffer.from(photo.bytes); verifyDisplayWebp(bytes,before.front); displayCheck(sha(bytes) === before.front.sha256);
      const after = await snapshot(cookie,cardId,s); assertDisplayBinding(after.binding,before.binding);
      displayCheck(JSON.stringify(after.front) === JSON.stringify(before.front) && displayBindingKey(after.binding) === displayBindingKey(before.binding));
      s.throwIfAborted(); return {bytes,contentType:before.front.contentType,sha256:before.front.sha256};
    },signal); },
  });
}
