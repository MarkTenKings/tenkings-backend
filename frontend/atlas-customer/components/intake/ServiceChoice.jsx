import { useEffect, useState } from 'react';
import { request } from '../../lib/client.mjs';

export default function ServiceChoice({ value, onChange }) {
  const [locations, setLocations] = useState([]), [query, setQuery] = useState(''), [error, setError] = useState(''), [loading, setLoading] = useState(false), [mapId, setMapId] = useState(null);
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const schedule = times => (times ?? []).map(item => `${days[item.weekday]} ${item.time}${item.cutoff ? ` (cutoff ${item.cutoff})` : ''}`).join('; ');
  const date = (value, zone) => value ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: zone }).format(new Date(value)) : 'Schedule unavailable';
  async function search(extra = {}) {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ ...(query ? { query } : {}), ...extra });
      const result = await request(`/intake/locations${params.size ? `?${params}` : ''}`);
      setLocations(result.locations ?? []);
      if (result.resolvedLocationId) onChange({ intakeMethod: 'DEALER_DROP_OFF', kioskId: result.resolvedLocationId });
    } catch { setError('Kiosk locations are unavailable right now. Please try again later.'); } finally { setLoading(false); }
  }
  useEffect(() => { const params = new URLSearchParams(window.location.search); const entry = params.get('kiosk'); search(entry ? { entry } : {}); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  function locate() {
    if (!navigator.geolocation) { setError('Location is unavailable. Search by ZIP code or city.'); return; }
    navigator.geolocation.getCurrentPosition(position => search({ lat: position.coords.latitude.toFixed(5), lng: position.coords.longitude.toFixed(5) }),
      () => setError('You can search by ZIP code or city without sharing your location.'), { timeout: 10000, maximumAge: 60000 });
  }
  return <section className="service-choice"><div className="section-heading"><div><span className="eyebrow">Choose your service</span><h1>Your cards. Your way.</h1><p>Choose how your cards reach ATLAS before adding them.</p></div></div>
    <div className="intake-options">
      <button className={`panel service-card ${value?.intakeMethod === 'MAIL_IN' ? 'selected' : ''}`} onClick={() => onChange({ intakeMethod: 'MAIL_IN', kioskId: null })}>
        <span className="eyebrow">MAIL YOUR CARDS</span><h2>$40 <small>/ card + shipping</small></h2><strong>Two-week service</strong><p>See your FedEx shipping quote before payment, then print your label and send your cards.</p><span className="text-link">Start mail-in →</span>
      </button>
      <button className={`panel service-card ${value?.intakeMethod === 'DEALER_DROP_OFF' ? 'selected' : ''}`} onClick={() => onChange({ intakeMethod: 'DEALER_DROP_OFF', kioskId: null })}>
        <span className="eyebrow">DROP OFF NEARBY</span><h2>$50 <small>/ card</small></h2><strong>One week from ATLAS pickup</strong><p>ATLAS pickup and return included. Submit from your phone and use your location’s kiosk dropbox.</p><span className="text-link">Find a dealer →</span>
      </button>
    </div><p className="fine">Applicable taxes appear at checkout. Your photos identify your cards; grading starts after physical intake.</p>
    {value?.intakeMethod === 'DEALER_DROP_OFF' && <div className="panel location-picker"><h2>Find an authorized kiosk</h2><form onSubmit={event => { event.preventDefault(); search(); }} className="location-search"><label><span>ZIP code or city</span><input value={query} onChange={event => setQuery(event.target.value)} maxLength={100}/></label><button className="secondary" disabled={loading}>Search</button><button className="text-link" type="button" onClick={locate}>Use my location</button></form>
      {error && <p role="status">{error}</p>}{loading ? <p role="status">Finding locations…</p> : !locations.length ? <p>No enabled kiosk locations are available for this search.</p> : <div className="location-list">{locations.map(location => <article key={location.id} className={`location-option ${value.kioskId === location.id ? 'selected' : ''}`}>
        <h3>{location.name}</h3><p>{typeof location.address === 'string' ? location.address : Object.values(location.address ?? {}).filter(Boolean).join(', ')}</p><p>Pickup: {schedule(location.schedule?.pickups)}<br/>Return: {schedule(location.schedule?.returns)}<br/>{location.timeZone ?? location.schedule?.timeZone}</p>
        {location.nextCollection && <p>Next collection: {date(location.nextCollection, location.timeZone)}<br/>Projected return: {date(location.projectedReturn, location.timeZone)}</p>}
        {location.schedule?.exceptions?.map(exception => <p key={`${exception.date}-${exception.kind}`} className="fine">{exception.date}: {exception.kind} {exception.cancelled ? 'canceled' : exception.time}. {exception.reason}</p>)}
        {typeof location.directionsUrl === 'string' && /^https:\/\/(?:www\.)?google\.com\/maps\//.test(location.directionsUrl) && <a href={location.directionsUrl} target="_blank" rel="noreferrer">Map & directions ↗</a>}
        <button className="secondary" onClick={() => onChange({ intakeMethod: 'DEALER_DROP_OFF', kioskId: location.id })}>{value.kioskId === location.id ? 'Selected' : 'Choose this kiosk'}</button>
        {typeof location.mapEmbedUrl === 'string' && /^https:\/\/maps\.google\.com\/maps\?/.test(location.mapEmbedUrl) && (mapId === location.id ? <iframe src={location.mapEmbedUrl} title={`Map to ${location.name}`} loading="lazy" referrerPolicy="no-referrer" className="kiosk-map"/> : <button className="text-link" onClick={() => setMapId(location.id)}>Show location map</button>)}
      </article>)}</div>}
    </div>}
  </section>;
}
