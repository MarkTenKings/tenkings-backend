import React, { useEffect, useRef, useState } from 'react';
import { reportIdentityRows, validSlabPhoto, photoTilt, saleReferenceRows, moneyLabel, evidenceDate, safePresentationLink, groupSoldReferences, saleAmountLabel } from './report-presentation-ui.mjs';

export function CardIdentityDetails({ report, details }) {
  const rows = reportIdentityRows(report, details);
  if (!rows.length) return null;
  return <section className="rr-card-details" aria-label="Card details"><div className="rr-section-heading"><div><p className="rr-eyebrow">THE CARD</p><h2>Card details</h2></div><span className="rr-detail-note">Recorded identity</span></div>
    <dl className="rr-identity-grid">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
  </section>;
}

/** An actual presentation photograph, independent from the grading evidence. */
export function SlabPhotoHero({ photo, brandSrc }) {
  const plane = useRef(null), [failed, setFailed] = useState(false);
  const reset = () => { plane.current?.style.setProperty('--rr-tilt-x', '0deg'); plane.current?.style.setProperty('--rr-tilt-y', '0deg'); };
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    motion.addEventListener?.('change', reset); window.addEventListener('beforeprint', reset);
    return () => { motion.removeEventListener?.('change', reset); window.removeEventListener('beforeprint', reset); };
  }, []);
  if (!validSlabPhoto(photo) || failed) return null;
  const move = event => {
    if (typeof window === 'undefined' || !window.matchMedia?.('(hover: hover) and (pointer: fine)').matches
      || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const tilt = photoTilt(event, event.currentTarget.getBoundingClientRect());
    if (tilt) { plane.current?.style.setProperty('--rr-tilt-x', `${tilt.x}deg`); plane.current?.style.setProperty('--rr-tilt-y', `${tilt.y}deg`); }
  };
  return <figure className="rr-slab-hero" aria-label="Graded card photograph" onPointerMove={move} onPointerLeave={reset} onPointerCancel={reset}>
    <div className="rr-slab-wordmark" aria-hidden="true">ATLAS</div>
    <img className="rr-slab-brand" src={brandSrc} alt="ATLAS Grading · Know what you have"/>
    <div className="rr-slab-stage"><div ref={plane} className="rr-slab-plane"><img src={photo.url} alt={photo.alt} width={photo.width} height={photo.height} loading="eager" decoding="async" draggable={false}
      onError={() => setFailed(true)} onLoad={event => { if (event.currentTarget.naturalWidth !== photo.width || event.currentTarget.naturalHeight !== photo.height) setFailed(true); }}/></div></div>
    <figcaption><span>GRADED CARD PHOTOGRAPH</span>{photo.capturedAt && <time dateTime={photo.capturedAt}>{evidenceDate(photo.capturedAt)}</time>}</figcaption>
  </figure>;
}

function MarketReferences({ market, printing }) {
  const [groupKey, setGroupKey] = useState(''), tabs = useRef(null);
  const sales = saleReferenceRows(market?.sales), groups = groupSoldReferences(sales);
  const selected = groups.find(group => group.key === groupKey) ?? groups[0];
  const visible = printing ? groups : selected ? [selected] : [];
  const estimate = market?.estimate;
  const low = estimate && moneyLabel(estimate.lowMinor, estimate.currency), high = estimate && moneyLabel(estimate.highMinor, estimate.currency);
  if (!sales.length && !(low && high)) return null;
  function navigate(event, index) {
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? groups.length - 1 : event.key === 'ArrowRight' ? (index + 1) % groups.length : event.key === 'ArrowLeft' ? (index + groups.length - 1) % groups.length : null;
    if (target === null) return; event.preventDefault(); setGroupKey(groups[target].key);
    const button = tabs.current?.querySelectorAll('[role="tab"]')[target]; button?.focus(); button?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  return <section className="rr-market" aria-label="Market references"><div className="rr-section-heading"><div><p className="rr-eyebrow">THE MARKET</p><h2>Sales, with context.</h2><p>Selected sold references, grouped by their recorded grade and identity. Different grading companies are not equivalent.</p></div></div>
    {low && high && <div className="rr-valuation"><div><p className="rr-eyebrow">MARKET ESTIMATE</p><strong>{low === high ? low : `${low} – ${high}`}</strong><p>As of <time dateTime={estimate.asOf}>{evidenceDate(estimate.asOf)}</time> · {estimate.sampleCount} sale{estimate.sampleCount === 1 ? '' : 's'}</p></div><p>{estimate.method}</p></div>}
    {sales.length > 0 && <>
      {!printing && <div className="rr-sale-groups" role="tablist" aria-label="Sales by grade, condition and variant" ref={tabs}>{groups.map((group, index) => <button type="button" key={group.key} role="tab" id={`rr-sales-tab-${index}`} aria-controls="rr-sales-panel" aria-selected={group.key === selected.key} tabIndex={group.key === selected.key ? 0 : -1} onClick={() => setGroupKey(group.key)} onKeyDown={event => navigate(event, index)}><strong>{group.label}</strong><span>{group.candidates.length} observed {group.candidates.length === 1 ? 'sale' : 'sales'}</span><small>{group.identityLabel}</small>{group.needsReview && <small>Identity details not fully established</small>}</button>)}</div>}
      <div id="rr-sales-panel" role={printing ? undefined : 'tabpanel'} aria-labelledby={printing ? undefined : `rr-sales-tab-${groups.indexOf(selected)}`}>
        {visible.map(group => <div className="rr-sale-group" key={group.key}><div className="rr-sale-group-heading"><h3>{group.label} sales</h3><span>Most recent first</span></div><p className="rr-sale-group-identity">{group.identityLabel}</p>
          <div className="rr-sales-scroll"><table className="rr-sales-table"><caption>eBay sold references · {group.label} · Most recent first</caption><thead><tr><th scope="col">Date</th><th scope="col">Sold listing</th><th scope="col">Sold price</th></tr></thead><tbody>{group.candidates.map(sale => <tr key={sale.id}><td>{sale.soldAt ? <time dateTime={sale.soldAt}>{evidenceDate(sale.soldAt)}</time> : 'Date not supplied'}</td><td><a href={sale.listingUrl} target="_blank" rel="noopener noreferrer">{sale.title}<span className="rr-external-mark" aria-hidden="true"> ↗</span></a></td><td>{sale.priceBasis === 'accepted_offer_unknown' ? <span className="rr-price-unknown">Accepted offer<br/>Amount undisclosed</span> : saleAmountLabel(sale)}</td></tr>)}</tbody></table></div>
        </div>)}
      </div><p className="rr-help">Sale amounts are shown as supplied by the source. Grades from different companies are shown as recorded; they are not equivalent ATLAS grades. Retrieved <time dateTime={market.observedAt}>{evidenceDate(market.observedAt)}</time>.</p>
    </>}
  </section>;
}

function DealerOpportunities({ offers, directory }) {
  // Verify the current clock before showing time-limited offers. The saved
  // presentation's update date is not proof that an offer is still active.
  // A null initial clock also keeps server/client hydration consistent.
  const [now, setNow] = useState(null);
  useEffect(() => {
    let timer;
    const tick = () => {
      const clock = Date.now(); setNow(clock);
      const deadlines = (offers ?? []).map(offer => Date.parse(offer.expiresAt)).filter(value => value > clock);
      if (deadlines.length) timer = setTimeout(tick, Math.min(2147483647, Math.max(1, Math.min(...deadlines) - clock + 1)));
    };
    tick();
    return () => clearTimeout(timer);
  }, [offers]);
  const current = now === null ? [] : (offers ?? []).filter(offer => Date.parse(offer.expiresAt) > now && moneyLabel(offer.amountMinor, offer.currency) && safePresentationLink(offer.dealerUrl, { localOnly: true }));
  const directoryUrl = directory?.url === '/dealers?service=buy' ? directory.url : null;
  if (!current.length && !directoryUrl) return null;
  return <section className="rr-dealers" aria-label="Authorized dealer network"><div className="rr-section-heading"><div><p className="rr-eyebrow">YOUR NEXT MOVE</p><h2>Keep it. Or find its next home.</h2><p>Connect with an ATLAS authorized dealer to sell this card or submit your next cards for grading.</p></div>{directoryUrl && <a className="rr-dealer-cta" href={directoryUrl}>Find an authorized dealer <span aria-hidden="true">↗</span></a>}</div>
    {current.length > 0 && <div className="rr-offer-grid">{current.map(offer => <article className="rr-dealer-offer" key={offer.id}><p className="rr-eyebrow">{offer.kind === 'firm' ? 'DEALER OFFER' : 'INDICATIVE OFFER'}</p><h3>{offer.dealerName}</h3><strong>{moneyLabel(offer.amountMinor, offer.currency)}</strong><p className="rr-offer-expiry">Expires <time dateTime={offer.expiresAt}>{new Date(offer.expiresAt).toISOString().replace('T', ' ').slice(0, 16)} UTC</time></p><p>{offer.terms}</p><a href={offer.dealerUrl}>View dealer <span aria-hidden="true">↗</span></a></article>)}</div>}
  </section>;
}

export function ReportMarketAndDealers({ presentation, printing = false }) {
  if (!presentation) return null;
  return <><MarketReferences market={presentation.market} printing={printing}/><DealerOpportunities offers={presentation.dealerOffers} directory={presentation.dealerDirectory}/></>;
}
