import React, { useEffect, useRef, useState } from 'react';
import { manualRequest } from '../lib/manual-client.mjs';
import { createDealerOffersClient } from '../lib/dealer-offers-client.mjs';
import styles from './MarketReferencePicker.module.css';

const money = offer => { const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: offer.currency });
  return formatter.format(offer.amountMinor / 10 ** formatter.resolvedOptions().maximumFractionDigits); };
export default function DealerOfferPicker({ cardId, staffId, approvalActionId, csrf, available = false, disabled = false, onChange }) {
  const client = useRef(null), generation = useRef(0), lock = useRef(false), changed = useRef(onChange);
  changed.current = onChange;
  const [data, setData] = useState(null), [selected, setSelected] = useState([]), [pending, setPending] = useState(null),
    [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  useEffect(() => {
    const owner = generation, version = ++owner.current; client.current = null; lock.current = false;
    setData(null); setSelected([]); setPending(null); setBusy(false); setError(''); setMessage('');
    if (!available) return;
    Promise.resolve().then(async () => {
      const value = createDealerOffersClient({ cardId, staffId, approvalActionId, storage: window.sessionStorage,
        request: (path, options = {}) => manualRequest(path, { ...options, csrf }) });
      if (version !== generation.current) return;
      client.current = value; const status = await value.read();
      if (version === generation.current) { setData(status); setPending(value.pending()); }
    }).catch(() => { if (version === generation.current) setError('Dealer terms could not be loaded. Check their status again.'); });
    return () => { if (owner.current === version) owner.current++; };
  }, [cardId, staffId, approvalActionId, csrf, available]);
  async function act(action) {
    const value = client.current, version = generation.current;
    if (!value || lock.current || disabled) return;
    lock.current = true; setBusy(true); setError(''); setMessage('');
    try {
      let result;
      if (action === 'refresh') result = await value.read();
      else if (action === 'superseded') await value.reconcileSuperseded();
      else if (action === 'resume') result = await value.resume();
      else result = await value.select({ sourceHash: data.sourceHash, expectedRevision: data.revision, selectedIds: action === 'remove' ? [] : selected });
      if (version !== generation.current) return;
      if (action !== 'refresh' && action !== 'superseded') {
        changed.current?.(result); setMessage(result.presentation.dealerOffers.length ? 'Dealer offers published.' : 'Dealer offers removed.');
      }
      const status = action === 'refresh' ? result : await value.read();
      if (version === generation.current) { setData(status); setSelected([]); setPending(value.pending()); }
    } catch (failure) { if (version === generation.current) {
      setPending(value.pending());
      setError(failure?.code === 'DEALER_OFFER_REVIEW_REQUIRED' ? 'The report or dealer terms changed. Refresh and review the current offers.'
        : 'The result is not confirmed. Check the saved request before making another selection.');
    } }
    finally { if (version === generation.current) { lock.current = false; setBusy(false); } }
  }
  if (!available) return null;
  const blocked = disabled || busy || Boolean(pending);
  return <section className={styles.panel} aria-label="Dealer offers for this report"><p className={styles.eyebrow}>REPORT · DEALER OFFERS</p><h3>Actual offers. Exact terms.</h3>
    <p className={styles.note}>Publish sourced dealer terms for this approved card. An indicative offer remains subject to its stated conditions; contact requests are not offers.</p>
    {pending ? <button type="button" disabled={disabled || busy} onClick={() => void act(pending.approvalActionId === approvalActionId ? 'resume' : 'superseded')}>{pending.approvalActionId === approvalActionId ? 'Check saved offer selection' : 'Use current report'}</button> : <>
      {!data ? <p>Checking dealer terms…</p> : !data.offers.length ? <p className={styles.note}>No active offer is configured for this report. An administrator needs the dealer’s buying authorization, card-specific amount and currency, firm or indicative status, written terms, expiry and source reference. <a href="/dealers?service=buy" target="_blank" rel="noopener noreferrer">Contact an authorized dealer ↗</a></p>
        : <div>{data.offers.map(offer => <article key={offer.id} className={styles.offer}><label><input type="checkbox" checked={selected.includes(offer.id)} disabled={blocked} aria-label={`Publish ${offer.dealerName} ${offer.kind} offer`}
          onChange={event => setSelected(event.target.checked ? [...selected, offer.id] : selected.filter(id => id !== offer.id))}/><strong>{offer.dealerName} · {money(offer)} · {offer.kind === 'firm' ? 'Firm offer' : 'Indicative offer'}</strong></label><p>{offer.terms}</p>
          <p>Expires {offer.expiresAt.replace('T', ' ').replace('.000Z', ' UTC')}</p><small>Source: {offer.source.reference} · received {offer.source.receivedAt.slice(0, 10)}</small></article>)}</div>}
      <div className={styles.actions}><button type="button" disabled={blocked} onClick={() => void act('refresh')}>Refresh dealer terms</button>
        {data?.offers.length > 0 && <button type="button" disabled={blocked || !selected.length} onClick={() => void act('publish')}>Publish selected offers</button>}
        {data?.selectedIds.length > 0 && <button type="button" disabled={blocked} onClick={() => void act('remove')}>Remove published offers</button>}</div>
    </>}
    {busy && <p role="status">Checking saved terms…</p>}{message && <p role="status">{message}</p>}{error && <p role="alert" className={styles.error}>{error}</p>}
  </section>;
}
