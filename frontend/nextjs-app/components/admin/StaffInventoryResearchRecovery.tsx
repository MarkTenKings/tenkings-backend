import { staffInventoryRecoveryDisplay, type StaffInventoryResearchRecoverySnapshot } from '../../lib/staffInventoryMarketValue';
import { COLLECT_SITE_ORIGIN } from '../../lib/siteRoutes';
import styles from './StaffInventoryResearchRecovery.module.css';

const fieldNames = { name: 'Card name', category: 'Category', manufacturer: 'Manufacturer / publisher', card_number: 'Card number', year: 'Year', set_name: 'Set', variant: 'Variant / finish', card_type: 'Card type' } as const;
const needLabels: Record<NonNullable<StaffInventoryResearchRecoverySnapshot['need_codes']>[number], string> = {
  MISSING_ORIGINAL_PHOTOS: 'The original card photos are missing or could not be verified.',
  MISSING_IDENTITY_FIELDS: 'Required card details are still missing.',
  DESCRIPTION_CONFLICT: 'A photo observation conflicts with saved card details.',
  RECOGNITION_UNAVAILABLE: 'Photo recognition was unavailable during the last check.',
  RECOGNITION_FAILED: 'The last photo recognition attempt did not complete.',
  RECOGNITION_DEFERRED: 'Photo recognition is waiting for a later eligible check.',
  CATALOG_UNAVAILABLE: 'Catalog evidence could not be read during the last check.',
  MISSING_CATALOG_REFERENCE: 'No reviewed catalog reference matches this card identity.',
  MISSING_DIAGNOSTIC_EVIDENCE: 'Reviewed evidence does not yet distinguish this printing or finish.',
  AMBIGUOUS_CATALOG_IDENTITY: 'More than one catalog identity remains plausible.',
  UNSUPPORTED_CATEGORY: 'This card category is not supported by automatic recovery.',
};
const catalogNeeds = new Set(['CATALOG_UNAVAILABLE', 'MISSING_CATALOG_REFERENCE', 'MISSING_DIAGNOSTIC_EVIDENCE', 'AMBIGUOUS_CATALOG_IDENTITY']);
function date(value: string) { return new Date(value).toLocaleString(); }

/** Displays durable recovery evidence only. Opening this view never starts paid work or saves a proposal. */
export default function StaffInventoryResearchRecovery({ snapshot, enabled, onEditDetails }: {
  snapshot: StaffInventoryResearchRecoverySnapshot; enabled: boolean; onEditDetails?: () => void;
}) {
  const display = staffInventoryRecoveryDisplay(snapshot, enabled);
  const added = snapshot.added_fields.filter(field => snapshot.proposal?.[field] != null);
  const needs = [...new Set(snapshot.need_codes ?? [])];
  const sources = snapshot.source_discovery;
  const needsCatalog = snapshot.status === 'waiting_catalog_evidence' || needs.some(need => catalogNeeds.has(need)) || !!sources;
  const hasReview = added.length > 0 || snapshot.conflicts.length > 0 || snapshot.missing_fields.length > 0 || snapshot.status === 'needs_staff_review';
  return <section className={styles.recovery} aria-label="Automatic research recovery">
    <div role="status" aria-live="polite"><h4>{display.label}</h4><p>{snapshot.reason}</p></div>
    {display.active && <p>You can keep adding inventory or close this card while the background check continues.</p>}
    {!enabled && !display.paused && snapshot.status !== 'resolved' && <p>Automatic checks are paused. The last saved outcome remains below.</p>}
    {snapshot.missing_fields.length > 0 && <p><strong>Still missing:</strong> {snapshot.missing_fields.map(field => fieldNames[field]).join(', ')}.</p>}
    {needs.length > 0 && <ul className={styles.needs} aria-label="Evidence still needed">{needs.map(need => <li key={need}>{needLabels[need]}</li>)}</ul>}
    {sources && <div className={styles.sources}>
      <h5>Unreviewed source suggestions</h5>
      {sources.status === 'candidates' ? <><p>Search results only. The recovery check has not fetched or approved these pages as catalog evidence.</p><ul>{sources.candidates.map(source => <li key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a><span>{source.domain}</span></li>)}</ul></>
        : <p>{sources.status === 'not_found' ? 'The bounded source search found no usable review links.' : 'Source search was unavailable during the last check.'} Catalog evidence is still needed.</p>}
    </div>}
    {(added.length > 0 || snapshot.conflicts.length > 0) && <div className={styles.proposals}>
      <h5>Photo suggestions · not saved to inventory</h5>
      <p>These suggestions do not confirm a catalog identity. Review your saved photos before changing details.</p>
      <dl>{added.map(field => <div key={field}><dt>{fieldNames[field]}</dt><dd><span>Suggested:</span> {snapshot.proposal![field]}</dd></div>)}
        {snapshot.conflicts.map(conflict => <div key={`conflict:${conflict.field}`}><dt>{fieldNames[conflict.field]} · differs from saved details</dt><dd><span>Saved:</span> {conflict.saved_value}</dd><dd><span>Suggested:</span> {conflict.suggested_value}</dd><dd className={styles.observation}>{conflict.evidence}</dd></div>)}
      </dl>
    </div>}
    {snapshot.checked_at && <p className={styles.timing}>Last checked <time dateTime={snapshot.checked_at}>{date(snapshot.checked_at)}</time>.</p>}
    {enabled && snapshot.next_check_at && snapshot.status !== 'resolved' && <p className={styles.timing}>Next eligible evidence check <time dateTime={snapshot.next_check_at}>{date(snapshot.next_check_at)}</time>. A check does not guarantee a new search or a value.</p>}
    {hasReview && (onEditDetails ? <button type="button" onClick={onEditDetails}>Review in Edit details</button> : <p>Use Edit details &amp; price to review or correct the saved card details.</p>)}
    {needsCatalog && <div className={styles.catalog}><a href={`${COLLECT_SITE_ORIGIN}/admin/set-ops-review`} target="_blank" rel="noreferrer">Open catalog review</a><p>Catalog evidence must pass the existing authenticated review and publication steps before it can support research.</p></div>}
  </section>;
}
