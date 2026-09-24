import { useEffect, useRef, useState } from 'react';
import { request } from '../../lib/client.mjs';

function ServiceFilm({ kind, label }) {
  const video = useRef(null), [playing, setPlaying] = useState(false), [available, setAvailable] = useState(false);
  useEffect(() => { const reduced = window.matchMedia('(prefers-reduced-motion: reduce)'); if (!reduced.matches && available) video.current?.play().then(() => setPlaying(true)).catch(() => {}); }, [available]);
  return <div className={`service-film service-film-${kind}`}><video ref={video} muted loop playsInline preload="metadata" poster={`/account/atlas/submission-${kind}.jpg`} onCanPlay={() => setAvailable(true)} aria-label={label}><source src={`/account/atlas/submission-${kind}.mp4`} type="video/mp4"/></video>{available && <button type="button" className="film-control" aria-label={playing ? `Pause ${label}` : `Play ${label}`} onClick={event => { event.stopPropagation(); if (playing) video.current.pause(); else video.current.play().catch(() => {}); setPlaying(!playing); }}>{playing ? 'Ⅱ' : '▶'}</button>}</div>;
}
function ServiceJourney({ kind }) {
  const steps = kind === 'kiosk' ? ['Drop off at dealer', 'ATLAS collects & grades', 'Back at your dealer'] : ['Send via FedEx', 'ATLAS grades', 'Return shipment'];
  return <ol className="service-journey" aria-label={kind === 'kiosk' ? 'Kiosk service journey' : 'Mail-in service journey'}>{steps.map((step, index) => <li key={step}><span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span><strong>{step}</strong></li>)}</ol>;
}
export default function ServiceChoice({ value, onChange }) {
  const [locations, setLocations] = useState([]), [dealerContacts, setDealerContacts] = useState([]), [query, setQuery] = useState(''), [error, setError] = useState(''), [loading, setLoading] = useState(false), [mapId, setMapId] = useState(null);
  const searchVersion = useRef(0);
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const schedule = times => (times ?? []).map(item => `${days[item.weekday]} ${item.time}${item.cutoff ? ` (cutoff ${item.cutoff})` : ''}`).join('; ');
  const date = (value, zone) => value ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: zone }).format(new Date(value)) : 'Schedule unavailable';
  async function search(extra = {}, searchQuery = query) {
    const version = ++searchVersion.current;
    setLoading(true); setError(''); setLocations([]); setDealerContacts([]);
    try {
      const params = new URLSearchParams({ ...(searchQuery ? { query: searchQuery } : {}), ...extra });
      const result = await request(`/intake/locations${params.size ? `?${params}` : ''}`);
      if (version !== searchVersion.current) return;
      setLocations(result.locations ?? []);
      setDealerContacts(result.dealerContacts ?? []);
      if (result.resolvedLocationId) onChange({ intakeMethod: 'DEALER_DROP_OFF', kioskId: result.resolvedLocationId });
    } catch { if (version === searchVersion.current) setError('We couldn’t load ATLAS Submission Stations. Please try again.'); } finally { if (version === searchVersion.current) setLoading(false); }
  }
  useEffect(() => { const params = new URLSearchParams(window.location.search); const entry = params.get('kiosk'); search(entry ? { entry } : {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  function locate() {
    if (!navigator.geolocation) { setError('Location is unavailable. Search by ZIP code or city.'); return; }
    navigator.geolocation.getCurrentPosition(position => { setQuery(''); search({ lat: position.coords.latitude.toFixed(5), lng: position.coords.longitude.toFixed(5) }, ''); },
      () => setError('You can search by ZIP code or city without sharing your location.'), { timeout: 10000, maximumAge: 60000 });
  }
  return <section className="service-choice"><div className="section-heading"><div><span className="eyebrow">Choose your move</span><h1 className="service-choice-title"><span>Two Speeds.</span>{' '}<span>Same Finish.</span></h1><p>Drop off nearby or send with FedEx. Every card gets the full ATLAS treatment.</p></div></div>
    <div className="intake-options service-comparison">
      <article className={`service-card service-card-kiosk ${value?.intakeMethod === 'DEALER_DROP_OFF' ? 'selected' : ''}`}>
        <div className="service-speed-label"><h2>Super Fast</h2><span>Authorized Dealer</span></div>
        <ServiceFilm kind="kiosk" label="ATLAS kiosk drop-off preview"/>
        <div className="service-card-body"><div className="service-card-title"><span className="eyebrow">LOCAL DROP-OFF</span><span className="service-badge">PICKUP + RETURN INCLUDED</span></div><p className="service-channel">ATLAS Submission Station<br/><strong>at an Authorized Dealer</strong></p><p>Drop your cards in the ATLAS kiosk at your local dealer. We handle pickup and return.</p>
          <dl className="service-metrics"><div><dt>Per card</dt><dd><strong>$50</strong><small>Transport included</small></dd></div><div><dt>Turnaround</dt><dd><strong>1 week</strong><small>From ATLAS collection</small></dd></div></dl>
          <ServiceJourney kind="kiosk"/><div className="service-details"><p><strong>Drop off. Pick up.</strong> Your cards return to the same dealer.</p><p>The clock starts when ATLAS collects your cards, not when you drop them off.</p></div>
          <button type="button" className={value?.intakeMethod === 'DEALER_DROP_OFF' ? 'primary' : 'secondary'} aria-pressed={value?.intakeMethod === 'DEALER_DROP_OFF'} onClick={() => onChange({ intakeMethod: 'DEALER_DROP_OFF', kioskId: value?.intakeMethod === 'DEALER_DROP_OFF' ? value.kioskId : null })}>{value?.intakeMethod === 'DEALER_DROP_OFF' ? 'Kiosk selected ✓' : 'Find an Authorized Dealer →'}</button></div>
      </article>
      <article className={`service-card service-card-mail ${value?.intakeMethod === 'MAIL_IN' ? 'selected' : ''}`}>
        <div className="service-speed-label"><h2>Fast</h2><span>Mail-in</span></div>
        <ServiceFilm kind="fedex" label="FedEx mail-in drop-off preview"/>
        <div className="service-card-body"><div className="service-card-title"><span className="eyebrow">FROM WHEREVER YOU ARE</span><span className="service-badge">FEDEX SHIPPING</span></div><p className="service-channel">Mail-in with FedEx<br/><strong>From your door to ATLAS</strong></p><p>Pack your cards and send them with FedEx. Your graded cards ship back to you.</p>
          <dl className="service-metrics"><div><dt>Per card</dt><dd><strong>$40</strong><small>Plus FedEx shipping</small></dd></div><div><dt>Service speed</dt><dd><strong>2 weeks</strong><small>Mail-in service</small></dd></div></dl>
          <ServiceJourney kind="mail"/><div className="service-details"><p><strong>Shipping at cost.</strong> See your actual FedEx quote before payment.</p><p>Final shipping and turnaround terms appear with your confirmed quote.</p></div>
          <button type="button" className={value?.intakeMethod === 'MAIL_IN' ? 'primary' : 'secondary'} aria-pressed={value?.intakeMethod === 'MAIL_IN'} onClick={() => onChange({ intakeMethod: 'MAIL_IN', kioskId: null })}>{value?.intakeMethod === 'MAIL_IN' ? 'Mail-in selected ✓' : 'Choose mail-in →'}</button></div>
      </article>
    </div><p className="fine">Applicable taxes and the full total appear before payment. Grading begins after your cards physically reach ATLAS.</p>
    {value?.intakeMethod === 'DEALER_DROP_OFF' && <div className="panel location-picker"><h2>Find a Atlas Submission Station at an Authorized Dealer near you</h2><form onSubmit={event => { event.preventDefault(); search(); }} className="location-search"><label><span>ZIP code or city</span><input value={query} onChange={event => setQuery(event.target.value)} maxLength={100}/></label><button className="secondary" disabled={loading}>Search</button><button className="text-link" type="button" onClick={locate}>Use my location</button></form>
      {error && <p role="status">{error}</p>}{loading ? <p role="status">Finding locations…</p> : !error && !locations.length && !dealerContacts.length ? <div className="location-empty" role="status"><strong>No ATLAS Submission Stations found{query ? ' for this search' : ' yet'}.</strong><p>{query ? 'Try another ZIP code or city, or choose mail-in.' : 'Authorized Dealer locations will appear here when available. You can choose mail-in now.'}</p></div> : <div className="location-list">{locations.map(location => <article key={location.id} className={`location-option ${value.kioskId === location.id ? 'selected' : ''}`}>
        <h3>{location.name}</h3><p>{typeof location.address === 'string' ? location.address : Object.values(location.address ?? {}).filter(Boolean).join(', ')}</p><p>Pickup: {schedule(location.schedule?.pickups)}<br/>Return: {schedule(location.schedule?.returns)}<br/>{location.timeZone ?? location.schedule?.timeZone}</p>
        {location.nextCollection && <p>Next collection: {date(location.nextCollection, location.timeZone)}<br/>Projected return: {date(location.projectedReturn, location.timeZone)}</p>}
        {location.schedule?.exceptions?.map(exception => <p key={`${exception.date}-${exception.kind}`} className="fine">{exception.date}: {exception.kind} {exception.cancelled ? 'canceled' : exception.time}. {exception.reason}</p>)}
        {typeof location.directionsUrl === 'string' && /^https:\/\/(?:www\.)?google\.com\/maps\//.test(location.directionsUrl) && <a href={location.directionsUrl} target="_blank" rel="noreferrer">Map & directions ↗</a>}
        <button className="secondary" onClick={() => onChange({ intakeMethod: 'DEALER_DROP_OFF', kioskId: location.id })}>{value.kioskId === location.id ? 'Selected' : 'Choose this kiosk'}</button>
        {typeof location.mapEmbedUrl === 'string' && /^https:\/\/maps\.google\.com\/maps\?/.test(location.mapEmbedUrl) && (mapId === location.id ? <iframe src={location.mapEmbedUrl} title={`Map to ${location.name}`} loading="lazy" referrerPolicy="no-referrer" className="kiosk-map"/> : <button className="text-link" onClick={() => setMapId(location.id)}>Show location map</button>)}
      </article>)}{dealerContacts.map(dealer => <article key={dealer.id} className="location-option dealer-contact">
        <span className="eyebrow">Authorized ATLAS Dealer</span><h3>{dealer.name}</h3><p>{Object.values(dealer.address).join(', ')}</p>
        <p><strong>Submission station setup in progress</strong></p><p>Contact this dealer for current arrangements. Kiosk selection will be available when station setup is complete. You can choose mail-in now.</p>
        <a href={dealer.website} target="_blank" rel="noreferrer">Visit dealer website ↗</a>{' '}
        <a href={dealer.directionsUrl} target="_blank" rel="noreferrer">Map & directions ↗</a>
      </article>)}</div>}
    </div>}
  </section>;
}
