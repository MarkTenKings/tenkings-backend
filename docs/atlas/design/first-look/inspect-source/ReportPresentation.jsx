import React, { useEffect, useRef, useState } from 'react';
import { reportIdentityRows, validSlabPhoto, photoTilt, saleReferenceRows, moneyLabel, evidenceDate, safePresentationLink } from './report-presentation-ui.mjs';

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
  const [grader, setGrader] = useState('ALL');
  const sales = saleReferenceRows(market?.sales), graders = [...new Set(sales.map(sale => sale.grader))].sort();
  const selected = graders.includes(grader) ? grader : 'ALL', filtered = printing || selected === 'ALL' ? sales : sales.filter(sale => sale.grader === selected);
  const estimate = market?.estimate;
  const low = estimate && moneyLabel(estimate.lowMinor, estimate.currency), high = estimate && moneyLabel(estimate.highMinor, estimate.currency);
  if (!sales.length && !(low && high)) return null;
  return <section className="rr-market" aria-label="Market references"><div className="rr-section-heading"><div><p className="rr-eyebrow">THE MARKET</p><h2>Sales, with context.</h2><p>Recent sales are reference points. Different graders, grades and sale dates can carry different prices.</p></div>
    {graders.length > 1 && <label className="rr-grader-filter">Grader<select aria-label="Filter sales by grader" value={selected} onChange={event => setGrader(event.target.value)}><option value="ALL">All graders</option>{graders.map(name => <option key={name}>{name}</option>)}</select></label>}
  </div>
    {low && high && <div className="rr-valuation"><div><p className="rr-eyebrow">MARKET ESTIMATE</p><strong>{low === high ? low : `${low} – ${high}`}</strong><p>As of <time dateTime={estimate.asOf}>{evidenceDate(estimate.asOf)}</time> · {estimate.sampleCount} sale{estimate.sampleCount === 1 ? '' : 's'}</p></div><p>{estimate.method}</p></div>}
    {sales.length > 0 && <><div className="rr-sales-scroll" role="region" aria-label="eBay sold reference table" tabIndex={0}><table className="rr-sales-table"><caption>eBay sold references · Most recent first</caption><thead><tr><th scope="col">Sold</th><th scope="col">Card</th><th scope="col">Grader / grade</th><th scope="col">Sale amount</th></tr></thead><tbody>{filtered.map(sale => <tr key={sale.id}><td>{sale.soldAt ? <time dateTime={sale.soldAt}>{evidenceDate(sale.soldAt)}</time> : 'Date not supplied'}</td><td><a href={sale.listingUrl} target="_blank" rel="noopener noreferrer">{sale.title}<span className="rr-external-mark" aria-hidden="true"> ↗</span></a></td><td><span className="rr-sale-grader">{sale.grader}</span><span className="rr-sale-grade">{sale.grade}</span></td><td>{sale.priceBasis === 'accepted_offer_unknown' ? <span className="rr-price-unknown">Accepted offer<br/>Amount undisclosed</span> : moneyLabel(sale.priceMinor, sale.currency)}</td></tr>)}</tbody></table></div>
      <p className="rr-help">Sale amounts are shown as supplied by the source. Grades from different companies are shown as recorded; they are not equivalent ATLAS grades. Retrieved <time dateTime={market.observedAt}>{evidenceDate(market.observedAt)}</time>.</p></>}
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
