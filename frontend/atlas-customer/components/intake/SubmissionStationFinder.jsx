import { useEffect, useRef, useState } from 'react';
import { request } from '../../lib/client.mjs';
import { dealerAddress, dealerDirectionsUrl, dealerMapUrl } from '../../lib/dealer-map.mjs';

const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const schedule = times => (times ?? []).map(item => `${days[item.weekday]} ${item.time}${item.cutoff ? ` (cutoff ${item.cutoff})` : ''}`).join('; ');
const date = (value, zone) => value ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: zone }).format(new Date(value)) : 'Schedule unavailable';

function StationMap({ location, url }) {
  const [state, setState] = useState('loading');
  useEffect(() => { const timer = setTimeout(() => setState(value => value === 'loading' ? 'slow' : value), 15000); return () => clearTimeout(timer); }, []);
  const directions = dealerDirectionsUrl(location.directionsUrl);
  return <section className="location-map" aria-label={`Google map to ${location.name}`}>
    <iframe src={url} title={`Google map to ${location.name}`} referrerPolicy="no-referrer" allowFullScreen onLoad={() => setState('loaded')} onError={() => setState('error')}/>
    {state === 'loading' && <p className="location-map-loading" role="status">Loading Google map…</p>}
    <div className="location-map-summary"><div><strong>{location.name}</strong><span>{dealerAddress(location.address)}</span></div>{directions && <a href={directions} target="_blank" rel="noreferrer">Open Google Maps ↗</a>}</div>
    {(state === 'slow' || state === 'error') && <p className="location-map-help" role="status">Map taking too long? Open Google Maps above, or use the dealer details below.</p>}
  </section>;
}

export default function SubmissionStationFinder({ value, onChange, visible }) {
  const [locations, setLocations] = useState([]), [dealerContacts, setDealerContacts] = useState([]), [query, setQuery] = useState(''), [error, setError] = useState('');
  const [loading, setLoading] = useState(false), [locating, setLocating] = useState(false), [mapEnabled, setMapEnabled] = useState(false), [mapId, setMapId] = useState(null), [searchedQuery, setSearchedQuery] = useState(''), [showingAll, setShowingAll] = useState(false);
  const searchVersion = useRef(0), currentValue = useRef(value), currentChange = useRef(onChange);
  currentValue.current = value; currentChange.current = onChange;
  async function search(extra = {}, searchQuery = query, showMap = true, version = ++searchVersion.current) {
    setLoading(true); setLocating(false); setError(''); setLocations([]); setDealerContacts([]); setMapId(null); setSearchedQuery(searchQuery.trim()); setShowingAll(false);
    if (showMap) setMapEnabled(true);
    try {
      const params = new URLSearchParams({ ...(searchQuery.trim() ? { query: searchQuery.trim() } : {}), ...extra });
      let result = await request(`/intake/locations${params.size ? `?${params}` : ''}`);
      if (version !== searchVersion.current) return;
      // The directory has literal city/ZIP matching, not a ZIP geocoder. Keep
      // nearby-ZIP searches useful without inventing proximity or coordinates.
      if (searchQuery.trim() && !result.locations?.length && !result.dealerContacts?.length) {
        result = await request('/intake/locations');
        if (version !== searchVersion.current) return;
        setShowingAll(Boolean(result.locations?.length || result.dealerContacts?.length));
      }
      if (version !== searchVersion.current) return;
      setLocations(result.locations ?? []); setDealerContacts(result.dealerContacts ?? []);
      // A kiosk entry may initialize service choice, but an older response must
      // never replace an explicit mail-in choice made while it was loading.
      if (result.resolvedLocationId && currentValue.current?.intakeMethod !== 'MAIL_IN') currentChange.current({ intakeMethod: 'DEALER_DROP_OFF', kioskId: result.resolvedLocationId });
    } catch { if (version === searchVersion.current) setError('We couldn’t load ATLAS Submission Stations. Please try again.'); }
    finally { if (version === searchVersion.current) setLoading(false); }
  }
  useEffect(() => {
    const entry = new URLSearchParams(window.location.search).get('kiosk'); search(entry ? { entry } : {}, '', false);
    return () => { searchVersion.current++; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  function locate() {
    const version = ++searchVersion.current;
    setLoading(false); setError('');
    if (!navigator.geolocation) { setLocating(false); setError('Location is unavailable. Search by ZIP code or city.'); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(position => {
      if (version !== searchVersion.current) return;
      setQuery(''); search({ lat: position.coords.latitude.toFixed(5), lng: position.coords.longitude.toFixed(5) }, '', true, version);
    }, () => {
      if (version !== searchVersion.current) return;
      setLocating(false); setError('You can search by ZIP code or city without sharing your location.');
    }, { timeout: 10000, maximumAge: 60000 });
  }
  if (!visible) return null;
  const results = [...locations, ...dealerContacts], mappable = results.map(location => ({ location, url: dealerMapUrl(location) })).filter(item => item.url);
  const shown = mappable.find(item => item.location.id === mapId) ?? mappable.find(item => item.location.id === value?.kioskId) ?? mappable[0];
  const showLocation = id => { setMapId(id); setMapEnabled(true); };
  return <section className="panel location-picker" aria-labelledby="submission-station-heading">
    <h2 id="submission-station-heading">Find an ATLAS Submission Station at an Authorized Dealer near you</h2>
    <form onSubmit={event => { event.preventDefault(); search(); }} className="location-search"><label><span>ZIP code or city</span><input value={query} onChange={event => setQuery(event.target.value)} maxLength={100} autoComplete="off"/></label><button className="secondary" disabled={loading}>Search</button><button className="text-link" type="button" onClick={locate} disabled={locating}>{locating ? 'Locating…' : 'Use my location'}</button></form>
    <p className="fine location-map-privacy">Search loads Google Maps for matching dealer locations. Your device location is used only by ATLAS to sort locations.</p>
    {error && <p role="status">{error}</p>}
    {loading ? <p role="status">Finding locations…</p> : !error && !results.length && !locating ? <div className="location-empty" role="status"><strong>No ATLAS Submission Stations found{searchedQuery ? ' for this search' : ' yet'}.</strong><p>{searchedQuery ? 'Try another ZIP code or city, or choose mail-in.' : 'Authorized Dealer locations will appear here when available. You can choose mail-in now.'}</p></div> : <>
      {showingAll && <p className="location-search-scope" role="status">No exact city or ZIP match for “{searchedQuery}”. Showing all listed ATLAS dealers.</p>}
      {shown && (mapEnabled ? <><StationMap key={shown.url} location={shown.location} url={shown.url}/>{mappable.length > 1 && <div className="location-map-results" aria-label="Choose a dealer pin">{mappable.map(({ location }) => <button key={location.id} className="location-map-result" type="button" aria-pressed={shown.location.id === location.id} onClick={() => showLocation(location.id)}>{location.name}</button>)}</div>}</> : <button type="button" className="location-map-activate" onClick={() => setMapEnabled(true)}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg><span>Explore the dealer map<small>Load Google Maps</small></span><span aria-hidden="true">↗</span></button>)}
      <div className="location-list">{locations.map(location => { const directions = dealerDirectionsUrl(location.directionsUrl); return <article key={location.id} className={`location-option ${value?.kioskId === location.id ? 'selected' : ''}`}>
        <h3>{location.name}</h3><p>{dealerAddress(location.address)}</p><p>Pickup: {schedule(location.schedule?.pickups)}<br/>Return: {schedule(location.schedule?.returns)}<br/>{location.timeZone ?? location.schedule?.timeZone}</p>
        {location.nextCollection && <p>Next collection: {date(location.nextCollection, location.timeZone)}<br/>Projected return: {date(location.projectedReturn, location.timeZone)}</p>}
        {location.schedule?.exceptions?.map(exception => <p key={`${exception.date}-${exception.kind}`} className="fine">{exception.date}: {exception.kind} {exception.cancelled ? 'canceled' : exception.time}. {exception.reason}</p>)}
        <div className="location-links">{directions && <a href={directions} target="_blank" rel="noreferrer">Map & directions ↗</a>}{dealerMapUrl(location) && <button type="button" className="text-link" onClick={() => showLocation(location.id)}>Show on map</button>}</div>
        <button type="button" className="secondary" onClick={() => onChange({ intakeMethod: 'DEALER_DROP_OFF', kioskId: location.id })}>{value?.kioskId === location.id ? 'Selected' : 'Choose this kiosk'}</button>
      </article>; })}{dealerContacts.map(dealer => { const directions = dealerDirectionsUrl(dealer.directionsUrl); return <article key={dealer.id} className="location-option dealer-contact">
        <span className="eyebrow">Authorized ATLAS Dealer</span><h3>{dealer.name}</h3><p>{dealerAddress(dealer.address)}</p>
        <p><strong>Submission station setup in progress</strong></p><p>Contact this dealer for current arrangements. Kiosk selection will be available when station setup is complete. You can choose mail-in now.</p>
        <div className="location-links"><a href={dealer.website} target="_blank" rel="noreferrer">Visit dealer website ↗</a>{directions && <a href={directions} target="_blank" rel="noreferrer">Map & directions ↗</a>}{dealerMapUrl(dealer) && <button type="button" className="text-link" onClick={() => showLocation(dealer.id)}>Show on map</button>}</div>
      </article>; })}</div>
    </>}
  </section>;
}
