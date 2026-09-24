import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Shell from './Shell';
import { api, useStaffResource } from '../lib/client';
import { STAFF_REAUTHENTICATE_PATH } from '../lib/routes.mjs';
import { availableCustody, browserJournal, custodyInput, custodyNames, journalLock, locationForm, locationInput, newLocation, operationRecorded, operationsMessage, weekdays } from '../lib/customer-operations.mjs';
import styles from './CustomerOperations.module.css';

const base = 'manual-connected/dealer-operations';
const date = value => value ? new Date(value).toLocaleString() : 'Not recorded';
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const blankCustody = () => ({ kind: '', occurredAt: '', reference: '', note: '', expectedReturnAt: '', confirmed: false });
function Field({ label, children }) { return <label className={styles.field}><span>{label}</span>{children}</label>; }
function Entry({ label, value, onChange, ...props }) { return <Field label={label}><input value={value ?? ''} onChange={event => onChange(event.target.value)} {...props}/></Field>; }

export default function CustomerOperations({ staff }) {
  if (staff?.role !== 'REVIEWER') return <Shell staff={staff} manual title="Customer operations"><main className={styles.main}><h1>Customer operations</h1><p>A reviewer staff account is required.</p></main></Shell>;
  return <Operations staff={staff}/>;
}

export function Operations({ staff }) {
  const resource = useStaffResource(base), [tab, setTab] = useState('orders'), [pending, setPending] = useState(null), [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  const running = useRef(false), journal = useRef(null), currentStaff = useRef(staff.id);
  useEffect(() => {
    try { journal.current = browserJournal(window.localStorage, staff.id); setPending(journal.current.read()); setReady(true); }
    catch (e) { setError(operationsMessage(e)); setReady(false); }
    const changed = event => { if (event.key === journal.current?.key) { try { setPending(journal.current.read()); } catch (e) { setReady(false); setError(operationsMessage(e)); } } };
    window.addEventListener('storage', changed);
    return () => { window.removeEventListener('storage', changed); journal.current = null; };
  }, [staff.id]);
  async function freshSession() {
    const session = await api('session');
    if (!session.csrf || session.staff?.id !== currentStaff.current || session.staff.role !== 'REVIEWER') throw new Error('Sign in as the same reviewer before checking or recording this operation.');
    return session;
  }
  async function reconcile(store, saved) {
    const data = await api(base);
    if (operationRecorded(data, saved)) { store.clear(); setPending(null); setMessage('The exact operation is confirmed in the saved record.'); }
    else { setPending(saved); setMessage(saved.acknowledged ? 'The server accepted the action. The current roster has not confirmed its saved details; refresh saved status.' : 'The current roster has not confirmed this operation. Its exact content is retained.'); }
    resource.reload();
  }
  async function runAction(action, input, metadata = {}, retry = false) {
    if (running.current || !ready || resource.loading || !resource.session || (!retry && pending)) return;
    running.current = true; setBusy(true); setError(''); setMessage('');
    try {
      const store = journal.current;
      await journalLock(navigator, store.key, async () => {
        let saved = store.read(), isNew = !saved, attempted = false, accepted = false;
        if (!retry && saved) { setPending(saved); throw new Error('Resolve the retained operation before recording another.'); }
        if (retry && (!saved || saved.acknowledged || !['custody', 'bind-manual'].includes(saved.action))) throw new Error('Refresh saved status to reconcile this operation.');
        try {
          const session = await freshSession();
          if (isNew) { saved = { version: 1, staffId: staff.id, action, input, ...metadata, createdAt: new Date().toISOString(), acknowledged: false }; store.save(saved); setPending(saved); }
          attempted = true;
          await api(`${base}/${saved.action}`, { body: saved.input, csrf: session.csrf });
          accepted = true; saved = { ...saved, acknowledged: true }; store.save(saved); setPending(saved);
          await reconcile(store, saved);
        } catch (e) {
          if (isNew && !accepted && (!attempted || e.status >= 400 && e.status < 500)) { store.clear(); setPending(null); }
          else if (saved) setPending(saved);
          throw e;
        }
      });
    } catch (e) { setError(operationsMessage(e)); }
    finally { running.current = false; setBusy(false); }
  }
  async function checkSaved() {
    if (running.current || !journal.current) return;
    running.current = true; setBusy(true); setError('');
    try { const store = journal.current; await journalLock(navigator, store.key, async () => { await freshSession(); const saved = store.read(); if (saved) await reconcile(store, saved); else { setPending(null); resource.reload(); } }); }
    catch (e) { setError(operationsMessage(e)); }
    finally { running.current = false; setBusy(false); }
  }
  const disabled = busy || !!pending || !ready || resource.loading || !resource.session;
  return <Shell staff={staff} title="Customer operations" manual><main className={styles.main}>
    <header className={styles.heading}><div><p className={styles.eyebrow}>Customer submissions</p><h1>Customer operations</h1><p>Record custody, connect received cards to grading, and manage kiosk access.</p></div><button type="button" disabled={busy} onClick={() => pending ? checkSaved() : resource.reload()}>Refresh records</button></header>
    {error && <p className={styles.error} role="alert">{error}</p>}{message && <p className={styles.notice} role="status">{message}</p>}
    {pending && <section className={styles.pending} aria-label="Retained operation"><h2>{pending.acknowledged ? 'Action accepted · checking saved record' : 'An operation needs reconciliation'}</h2><p>This browser retains the exact {pending.action.replaceAll('-', ' ')} request. New actions are locked until it is reconciled.</p>
      {pending.input.cardId && <p>Customer card <code>{pending.input.cardId}</code></p>}{pending.input.requestId && <p>Request <code>{pending.input.requestId}</code></p>}
      {pending.action === 'custody' && <p>{custodyNames[pending.input.kind]} · {date(pending.input.occurredAt)} · Evidence: {pending.input.evidence.reference}</p>}
      <div className={styles.actions}><button type="button" disabled={busy} onClick={checkSaved}>Check saved status</button>{!pending.acknowledged && ['custody', 'bind-manual'].includes(pending.action) && <button type="button" disabled={busy || resource.loading || !resource.session} onClick={() => runAction(null, null, {}, true)}>Retry exact saved request</button>}<a href={STAFF_REAUTHENTICATE_PATH} target="_blank" rel="noreferrer">Sign in again in another tab</a></div>
      {!['custody', 'bind-manual'].includes(pending.action) && <p>Setup changes are not resubmitted automatically. If a fresh read cannot resolve this record, keep the journal and contact an administrator.</p>}
    </section>}
    <nav className={styles.tabs} aria-label="Customer operations sections">{[['orders', 'Paid submissions'], ['locations', 'Kiosk setup'], ['memberships', 'Dealer access']].map(([key, label]) => <button type="button" key={key} aria-current={tab === key ? 'page' : undefined} onClick={() => setTab(key)}>{label}</button>)}</nav>
    {resource.loading ? <p role="status">Loading current staff records…</p> : resource.error ? <div className={styles.panel}><p role="alert">{resource.error}</p><button type="button" onClick={resource.reload}>Try reading again</button>{resource.signedOut && <p><a href={STAFF_REAUTHENTICATE_PATH}>Sign in again</a></p>}</div> : !resource.data ? <p>No verified staff roster is available.</p> : <>
      {tab === 'orders' && <OrderRoster data={resource.data} disabled={disabled} onAction={runAction}/>}
      {tab === 'locations' && <LocationEditor locations={resource.data.locations ?? []} disabled={disabled} onAction={runAction}/>}
      {tab === 'memberships' && <MembershipEditor data={resource.data} disabled={disabled} onAction={runAction}/>}
    </>}
  </main></Shell>;
}

export function OrderRoster({ data, disabled, onAction }) {
  if (!data.orders?.length) return <section className={styles.empty}><h2>No paid customer submissions yet</h2><p>Confirmed paid orders will appear here with their individual cards.</p></section>;
  return <div className={styles.orders}><p className={styles.small}>Showing up to 100 recent paid submissions.</p>{data.orders.map(order => <section className={styles.order} key={order.id}><header className={styles.orderHeading}><div><p className={styles.eyebrow}>Paid submission</p><h2>{order.reference}</h2></div><p>{order.cards?.length ?? 0} cards · Paid {date(order.paidAt)}</p></header>{!order.cards?.length ? <p>No card roster was returned for this order.</p> : order.cards.map(card => <CustodyCard key={card.cardId} card={card} manualCards={data.manualCards ?? []} disabled={disabled} onAction={onAction}/>)}</section>)}</div>;
}

export function CustodyCard({ card, manualCards, disabled, onAction }) {
  const [form, setForm] = useState(blankCustody), [binding, setBinding] = useState({ manualCardId: '', evidenceRef: '', confirmed: false }), [error, setError] = useState('');
  const kinds = availableCustody(card), update = (key, value) => setForm(old => ({ ...old, confirmed: false, [key]: value }));
  const received = card.events?.some(event => event.kind === 'ATLAS_RECEIVED');
  async function submit(event) {
    event.preventDefault(); if (disabled) return; setError('');
    try { const input = custodyInput(card, form, () => crypto.randomUUID()); await onAction('custody', input); setForm(blankCustody()); }
    catch (e) { setError(e.message); }
  }
  async function bind(event) {
    event.preventDefault(); if (disabled) return; setError('');
    if (!received || card.manualCardId || !binding.confirmed || !manualCards.some(row => row.id === binding.manualCardId) || !binding.evidenceRef.trim()) { setError('Confirm the physical match and choose an accessible grading card after ATLAS receipt.'); return; }
    await onAction('bind-manual', { cardId: card.cardId, manualCardId: binding.manualCardId, evidenceRef: binding.evidenceRef.trim() });
  }
  return <article className={styles.card}><div className={styles.cardHeading}><div><p className={styles.eyebrow}>{card.channel === 'KIOSK' ? card.originalLocation ?? 'Kiosk' : 'Mail-in'}</p><h3>{card.identity?.title ?? 'Card details saved'}</h3><p className={styles.small}>Customer card <code>{card.cardId}</code></p></div><span className={styles.badge}>{card.grading === 'HUMAN_APPROVED' ? 'Human approval saved' : card.grading === 'IN_GRADING' ? 'In grading' : 'Awaiting grading intake'}</span></div>
    {card.turnaroundTarget && <p>Return target from actual collection: {date(card.turnaroundTarget)}.</p>}{card.scheduleChanged && <p className={styles.notice}>The kiosk schedule changed after checkout. The original schedule remains on the customer receipt.</p>}
    {card.events?.length ? <ol className={styles.timeline}>{card.events.map(event => <li key={event.id}><strong>{custodyNames[event.kind] ?? 'Recorded event'}</strong><span>{date(event.occurredAt)}</span>{event.note && <p>{event.note}</p>}{event.expectedReturnAt && <p>Expected return: {date(event.expectedReturnAt)}</p>}</li>)}</ol> : <p>No physical handoff has been recorded.</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    <details className={styles.details}><summary>Record an actual custody event</summary><form onSubmit={submit}><fieldset disabled={disabled}><legend>Physical event evidence</legend><p>Enter what already happened. All entered times use {browserZone()}.</p><div className={styles.grid}>
      <Field label="Event"><select required value={form.kind} onChange={event => update('kind', event.target.value)}><option value="">Choose the actual event</option>{kinds.map(kind => <option key={kind} value={kind}>{custodyNames[kind]}</option>)}</select></Field>
      <Entry label="Actual event date and time" type="datetime-local" required value={form.occurredAt} onChange={value => update('occurredAt', value)}/>
      <Entry label="Physical evidence reference" required maxLength={300} value={form.reference} onChange={value => update('reference', value)}/>
      {form.kind === 'DELAY_REPORTED' && <Entry label="Updated expected return (optional)" type="datetime-local" value={form.expectedReturnAt} onChange={value => update('expectedReturnAt', value)}/>}</div>
      <Field label={form.kind.startsWith('DELAY_') ? 'Customer-visible delay note (optional)' : 'Staff evidence note (optional)'}><textarea maxLength={500} value={form.note} onChange={event => update('note', event.target.value)}/></Field>
      <label className={styles.check}><input type="checkbox" checked={form.confirmed} onChange={event => update('confirmed', event.target.checked)}/>I verified this actual event, its time, and its evidence.</label><button className={styles.primary} disabled={!form.confirmed}>Record custody event</button>
    </fieldset></form></details>
    {card.manualCardId ? <p><Link href={`/manual/${card.manualCardId}`}>Open linked grading card</Link></p> : <details className={styles.details}><summary>Connect received card to grading</summary><form onSubmit={bind}><fieldset disabled={disabled || !received || !manualCards.length}><legend>Match the physical card</legend><p>{!received ? 'Record actual ATLAS receipt before linking a grading card.' : !manualCards.length ? 'No accessible, unlinked grading cards are available. Add the physical card through staff intake, then refresh.' : 'Inspect the physical card and its staff intake photos before confirming the match.'}</p>
      <Field label="Accessible grading card"><select required value={binding.manualCardId} onChange={event => setBinding({ ...binding, manualCardId: event.target.value, confirmed: false })}><option value="">Choose a saved grading card</option>{manualCards.map(row => <option key={row.id} value={row.id}>{row.id} · revision {row.revision}</option>)}</select></Field>
      {binding.manualCardId && <p><Link href={`/manual/${binding.manualCardId}`} target="_blank">Inspect selected grading card</Link></p>}
      <Entry label="Physical match evidence reference" required maxLength={300} value={binding.evidenceRef} onChange={value => setBinding({ ...binding, evidenceRef: value, confirmed: false })}/><label className={styles.check}><input type="checkbox" checked={binding.confirmed} onChange={event => setBinding({ ...binding, confirmed: event.target.checked })}/>I matched this received customer card to the selected grading card.</label><button className={styles.primary} disabled={!binding.confirmed}>Save grading link</button>
    </fieldset></form></details>}
  </article>;
}

function ScheduleEditor({ schedule, onChange }) {
  function edit(kind, index, key, value) { onChange({ ...schedule, [kind]: schedule[kind].map((row, i) => i === index ? { ...row, [key]: value } : row) }); }
  function remove(kind, index) { onChange({ ...schedule, [kind]: schedule[kind].filter((_, i) => i !== index) }); }
  return <><Entry label="Schedule time zone (IANA, for example America/New_York)" required value={schedule.timeZone} onChange={value => onChange({ ...schedule, timeZone: value })}/>
    {['pickups', 'returns'].map(kind => <section className={styles.schedule} key={kind}><h3>{kind === 'pickups' ? 'Weekly pickup schedule' : 'Weekly return schedule'}</h3>{!schedule[kind].length && <p>No weekly {kind} entered.</p>}{schedule[kind].map((row, index) => <div className={styles.scheduleRow} key={index}><Field label="Day"><select required value={row.weekday} onChange={event => edit(kind, index, 'weekday', event.target.value)}><option value="">Choose day</option>{weekdays.map((day, dayIndex) => <option key={day} value={dayIndex}>{day}</option>)}</select></Field><Entry label={kind === 'pickups' ? 'Pickup time' : 'Return time'} required type="time" value={row.time} onChange={value => edit(kind, index, 'time', value)}/>{kind === 'pickups' && <Entry label="Submission cutoff" required type="time" value={row.cutoff} onChange={value => edit(kind, index, 'cutoff', value)}/>}<button type="button" onClick={() => remove(kind, index)}>Remove</button></div>)}<button type="button" onClick={() => onChange({ ...schedule, [kind]: [...schedule[kind], { weekday: '', time: '', ...(kind === 'pickups' ? { cutoff: '' } : {}) }] })}>Add {kind === 'pickups' ? 'pickup' : 'return'} day</button></section>)}
    <section className={styles.schedule}><h3>Date exceptions</h3><p>Record closures or replacement times in the schedule time zone.</p>{schedule.exceptions.map((row, index) => <div className={styles.exception} key={index}><div className={styles.grid}><Entry label="Exception date" type="date" required value={row.date} onChange={value => edit('exceptions', index, 'date', value)}/><Field label="Applies to"><select value={row.kind} onChange={event => edit('exceptions', index, 'kind', event.target.value)}><option value="pickups">Pickups</option><option value="returns">Returns</option></select></Field></div><label className={styles.check}><input type="checkbox" checked={row.cancelled} onChange={event => edit('exceptions', index, 'cancelled', event.target.checked)}/>Cancelled on this date</label>{!row.cancelled && <div className={styles.grid}><Entry label="Replacement time" type="time" required value={row.time} onChange={value => edit('exceptions', index, 'time', value)}/>{row.kind === 'pickups' && <Entry label="Replacement cutoff" type="time" required value={row.cutoff} onChange={value => edit('exceptions', index, 'cutoff', value)}/>}</div>}<Entry label="Exception reason" required maxLength={240} value={row.reason} onChange={value => edit('exceptions', index, 'reason', value)}/><button type="button" onClick={() => remove('exceptions', index)}>Remove exception</button></div>)}<button type="button" onClick={() => onChange({ ...schedule, exceptions: [...schedule.exceptions, { date: '', kind: 'pickups', cancelled: true, reason: '' }] })}>Add date exception</button></section>
  </>;
}
function GrantNotice() { return <p className={styles.notice}>Setup changes require an existing operations grant and a sign-in from the last five minutes. <a href={STAFF_REAUTHENTICATE_PATH} target="_blank" rel="noreferrer">Sign in again</a>. The server checks permission when you save.</p>; }

export function LocationEditor({ locations, disabled, onAction }) {
  const [form, setForm] = useState(newLocation), [error, setError] = useState('');
  const update = (key, value) => setForm(old => ({ ...old, [key]: value }));
  async function submit(event) { event.preventDefault(); if (disabled) return; setError(''); try { const input = locationInput(form, () => crypto.randomUUID()); setForm(old => ({ ...old, id: input.id })); await onAction('location-configure', input); } catch (e) { setError(e.message); } }
  function token() { const bytes = crypto.getRandomValues(new Uint8Array(32)); update('entryToken', Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')); }
  return <section className={styles.panel}><h2>Kiosk registry</h2><GrantNotice/>{!locations.length ? <p>No kiosk locations are configured.</p> : <ul className={styles.roster}>{locations.map(row => <li key={row.id}><div><strong>{row.name}</strong><p>{row.enabled ? 'Enabled' : 'Disabled'} · revision {row.revision} · authorized until {date(row.authorized_until)}</p></div><button type="button" disabled={disabled} onClick={() => { setForm(locationForm(row)); setError(''); }}>Edit {row.name}</button></li>)}</ul>}
    <button type="button" disabled={disabled} onClick={() => { setForm(newLocation()); setError(''); }}>New kiosk location</button>
    <form onSubmit={submit} className={styles.form}><fieldset disabled={disabled}><legend>{form.expectedRevision ? `Edit location · revision ${form.expectedRevision}` : 'Configure a new location'}</legend><p>Use actual location, schedule, and linked device details. New locations start disabled.</p>{form.id && <p className={styles.small}>Location <code>{form.id}</code></p>}{error && <p className={styles.error} role="alert">{error}</p>}<div className={styles.grid}>
      <Entry label="Kiosk name" required maxLength={160} value={form.name} onChange={value => update('name', value)}/><Entry label="Dealer UUID" required readOnly={!!form.expectedRevision} value={form.dealerId} onChange={value => update('dealerId', value)}/>
      {[['line1', 'Street address'], ['city', 'City'], ['region', 'State / region'], ['postalCode', 'Postal code'], ['country', 'Two-letter country code']].map(([key, label]) => <Entry key={key} label={label} required maxLength={key === 'country' ? 2 : 180} value={form.address[key]} onChange={value => update('address', { ...form.address, [key]: value })}/>)}
      <Entry label="Latitude" type="number" step="any" min={-90} max={90} required value={form.position.lat} onChange={value => update('position', { ...form.position, lat: value })}/><Entry label="Longitude" type="number" step="any" min={-180} max={180} required value={form.position.lng} onChange={value => update('position', { ...form.position, lng: value })}/>
    </div><ScheduleEditor schedule={form.schedule} onChange={value => update('schedule', value)}/>
    <section className={styles.schedule}><h3>Linked equipment and access</h3><div className={styles.grid}>{[['terminalId', 'Linked payment terminal ID'], ['terminalLocationId', 'Payment terminal location ID'], ['packagePrinterId', 'Package printer ID']].map(([key, label]) => <Entry key={key} label={label} required maxLength={160} value={form[key]} onChange={value => update(key, value)}/>)}<Entry label={`Authorization expires (${browserZone()})`} type="datetime-local" required value={form.authorizedUntil} onChange={value => update('authorizedUntil', value)}/></div>
      <Entry label="Kiosk entry token" required minLength={32} maxLength={96} pattern="[A-Za-z0-9_-]{32,96}" value={form.entryToken} onChange={value => update('entryToken', value)}/><button type="button" onClick={token}>Generate new entry token</button><p className={styles.small}>Replacing an existing token invalidates its previous kiosk entry link after save.</p>
      <label className={styles.check}><input type="checkbox" checked={form.enabled} onChange={event => update('enabled', event.target.checked)}/>Enable this configured kiosk location</label>
    </section><button className={styles.primary}>Save kiosk configuration</button></fieldset></form>
  </section>;
}

export function MembershipEditor({ data, disabled, onAction }) {
  const [form, setForm] = useState({ accountId: '', locationId: '', decision: '', confirmed: false }), [error, setError] = useState('');
  const locations = data.locations ?? [], memberships = data.memberships ?? [];
  async function submit(event) {
    event.preventDefault(); if (disabled) return; setError('');
    if (!/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(form.accountId) || !locations.some(row => row.id === form.locationId) || !['grant', 'revoke'].includes(form.decision) || !form.confirmed) { setError('Enter the exact customer account, choose a configured location, and confirm the access decision.'); return; }
    const priorVersion = memberships.find(row => row.accountId === form.accountId && row.locationId === form.locationId)?.version ?? 0;
    await onAction('membership-configure', { accountId: form.accountId, locationId: form.locationId, enabled: form.decision === 'grant' }, { priorVersion });
  }
  return <section className={styles.panel}><h2>Dealer location access</h2><GrantNotice/><p>Membership links a real customer account to a specific kiosk. Enter the verified account UUID.</p>{!memberships.length ? <p>No dealer memberships are configured.</p> : <ul className={styles.roster}>{memberships.map(row => <li key={row.id}><div><strong>{locations.find(location => location.id === row.locationId)?.name ?? row.locationId}</strong><p><code>{row.accountId}</code> · {row.revokedAt ? 'Revoked' : 'Active'} · version {row.version}</p></div><button type="button" disabled={disabled} onClick={() => setForm({ accountId: row.accountId, locationId: row.locationId, decision: '', confirmed: false })}>Review access</button></li>)}</ul>}
    <form onSubmit={submit}><fieldset disabled={disabled || !locations.length}><legend>Change location access</legend>{!locations.length && <p>Configure a location before assigning dealer access.</p>}{error && <p className={styles.error} role="alert">{error}</p>}<div className={styles.grid}><Entry label="Customer account UUID" required value={form.accountId} onChange={value => setForm({ ...form, accountId: value, confirmed: false })}/><Field label="Kiosk location"><select required value={form.locationId} onChange={event => setForm({ ...form, locationId: event.target.value, confirmed: false })}><option value="">Choose a configured location</option>{locations.map(row => <option value={row.id} key={row.id}>{row.name}{row.enabled ? '' : ' (disabled)'}</option>)}</select></Field><Field label="Access decision"><select required value={form.decision} onChange={event => setForm({ ...form, decision: event.target.value, confirmed: false })}><option value="">Choose grant or revoke</option><option value="grant">Grant access</option><option value="revoke">Revoke access</option></select></Field></div><label className={styles.check}><input type="checkbox" checked={form.confirmed} onChange={event => setForm({ ...form, confirmed: event.target.checked })}/>I verified this customer account and the location access decision.</label><button className={styles.primary} disabled={!form.confirmed}>Save dealer access</button></fieldset></form>
  </section>;
}
