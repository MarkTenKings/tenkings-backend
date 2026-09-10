/* eslint-disable @next/next/no-img-element */
import { Children, cloneElement, isValidElement, useCallback, useEffect, useRef, useState, type ReactNode, type ReactElement } from 'react';
import Link from 'next/link';
import type { StaffInventoryCommand, StaffInventoryWorkspace as Workspace } from '@tenkings/database';
import { prepareStaffInventoryPhoto, STAFF_INVENTORY_PHOTO_ACCEPT } from '../../lib/inventoryPhotoUpload';
import StaffInventoryLocationBrowser from './StaffInventoryLocationBrowser';
import type { StaffInventoryMapLocation } from '../../lib/staffInventoryLocationsMap';
import styles from './StaffInventoryWorkspace.module.css';

type Item = Workspace['items'][number] & { photo_url?: string | null };
type Data = Omit<Workspace, 'items' | 'locations'> & { items: Item[]; locations: StaffInventoryMapLocation[] };
type Mode = 'add' | 'edit' | 'move' | 'prepare' | 'cost' | 'count' | 'location' | null;
type Pending = StaffInventoryCommand | { action: 'location'; request_id: string; name: string; address: string; inventoryKind: 'hq' | 'store' | 'kiosk' };
const API = '/api/v2/admin/inventory/workspace';
const money = (n: number | null | undefined) => n == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n / 100);
const stageNames: Record<string, string> = { unprocessed: 'Loose cards', processing: 'Being prepared', processed: 'Ready to pack', packed: 'Packed' };
const cents = (s: string) => {
  if (!s.trim()) return null;
  if (!/^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/.test(s.trim())) throw new Error('Enter dollars and cents using at most two decimal places.');
  const [w, f = ''] = s.trim().split('.'), n = Number(BigInt(w) * 100n + BigInt(f.padEnd(2, '0')));
  if (!Number.isSafeInteger(n)) throw new Error('This amount is too large.'); return n;
};
const amount = (n: number | null) => n === null ? '' : (n / 100).toFixed(2);
const localNow = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const fresh = () => ({ origin: '', type: '', name: '', category: '', quantity: '', cost: '', price: '', location: '', kind: '', machine: '', product: '', door: '', stage: '', date: localNow(), note: '', photo_key: null as string | null, photo_url: null as string | null, address: '', planned: false, costSplit: 'equal', cardCosts: {} as Record<string, string> });
type Draft = ReturnType<typeof fresh>;
function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    plus: <path d="M12 5v14M5 12h14" />, search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></>,
    box: <><path d="m12 3 9 5-9 5-9-5 9-5Z M3 8v9l9 5 9-5V8 M12 13v9 M7 5.8l9 5" /></>,
    pin: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />, close: <path d="m6 6 12 12M6 18 18 6" />,
    photo: <><rect x="3" y="5" width="18" height="15" rx="3" /><path d="m8 5 1-2h6l1 2" /><circle cx="12" cy="12" r="4" /></>,
    library: <><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8" cy="8" r="1.5" /><path d="m3 17 5-5 4 4 4-6 5 7" /></>,
    check: <path d="m5 12 4 4L19 6" />, cards: <><rect x="7" y="3" width="13" height="17" rx="2" /><path d="M4 6v14a3 3 0 0 0 3 3" /></>,
    chevron: <path d="m9 5 7 7-7 7" />, back: <path d="M20 12H4m6-6-6 6 6 6" />, refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 6a8 8 0 0 1 13 2M5 16a8 8 0 0 0 13 2" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.box}</svg>;
}
function Field({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  const nameControl = (nodes: ReactNode): ReactNode => Children.map(nodes, node => {
    if (!isValidElement(node)) return node;
    const el = node as ReactElement<{ children?: ReactNode; 'aria-label'?: string }>;
    return ['input', 'select', 'textarea'].includes(String(el.type)) ? cloneElement(el, { 'aria-label': label }) : el.props.children ? cloneElement(el, {}, nameControl(el.props.children)) : el;
  });
  return <label className={styles.field}><span>{label}</span>{nameControl(children)}{help && <small>{help}</small>}</label>;
}

export default function StaffInventoryWorkspace({ token, adminId, displayName, onAdvanced }: { token: string; adminId: string; displayName?: string | null; onAdvanced: () => void }) {
  const [data, setData] = useState<Data | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [tab, setTab] = useState('inventory'), [query, setQuery] = useState(''), [location, setLocation] = useState(''), [category, setCategory] = useState('');
  const [item, setItem] = useState<Item | null>(null), [selected, setSelected] = useState<string[]>([]), [mode, setMode] = useState<Mode>(null), [draft, setDraft] = useState<Draft>(fresh);
  const [busy, setBusy] = useState(false), [uploading, setUploading] = useState(false), [pending, setPending] = useState<Pending | null>(null), [rejected, setRejected] = useState(false);
  const [photoStatus, setPhotoStatus] = useState(''), [photoError, setPhotoError] = useState(''), [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null), active = useRef(true), saveLock = useRef(false), buttonRef = useRef<HTMLButtonElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null), libraryInput = useRef<HTMLInputElement>(null), photoFile = useRef<File | null>(null);
  const photoAttempt = useRef(0), photoLock = useRef(false), photoController = useRef<AbortController | null>(null);
  const releasePhotoAttempt = useCallback(() => {
    photoAttempt.current++; photoController.current?.abort(); photoController.current = null; photoFile.current = null; photoLock.current = false;
  }, []);
  const cancelPhoto = useCallback((message = '') => {
    releasePhotoAttempt(); setUploading(false); setPhotoError(''); setPhotoStatus(message); setPhotoPreview(null);
  }, [releasePhotoAttempt]);
  const pendingKey = `tenkings:staff-inventory:pending:${adminId}`, draftKey = `tenkings:staff-inventory:draft:${adminId}`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  async function load() {
    try {
      const response = await fetch(API, { headers, cache: 'no-store' }); const value = await response.json();
      if (!response.ok) throw new Error(value.message || 'Inventory is temporarily unavailable.');
      if (value.version !== 1 || !Array.isArray(value.items) || !Array.isArray(value.locations)) throw new Error('Inventory returned an unreadable response.');
      if (active.current) { setData(value); setError(''); }
    } catch (e) { if (active.current) setError(e instanceof Error ? e.message : 'Inventory could not be loaded.'); }
  }
  useEffect(() => {
    active.current = true; void load();
    try { const saved = sessionStorage.getItem(pendingKey); if (saved) { const value = JSON.parse(saved); if (value.actor !== adminId || !value.command?.request_id) throw new Error(); setPending(value.command); if (value.ui) { setDraft({ ...fresh(), ...value.ui.draft }); setMode(value.ui.mode); setItem(value.ui.item); setSelected(value.ui.selected ?? []); } setNotice('Your last save needs confirmation. Retry it below to finish without adding a duplicate.'); } } catch { setError('Your last saved request could not be read. Keep this tab open and contact your administrator.'); }
    return () => { active.current = false; releasePhotoAttempt(); };
  // Session changes remount this component. Never copy requests between accounts.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminId, token]);
  useEffect(() => { if (mode || busy || pending) return; const timer = setInterval(() => { if (!document.hidden) void load(); }, 10000); return () => clearInterval(timer); });
  useEffect(() => {
    if (!mode && !item) return;
    const previous = document.activeElement as HTMLElement | null, previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.querySelector<HTMLElement>('button, input, select, textarea')?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saveLock.current && !pending) { cancelPhoto(); setMode(null); setItem(null); }
      if (e.key === 'Tab') { const nodes = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled):not([tabindex="-1"]), select:not(:disabled), textarea:not(:disabled), a[href]'); if (!nodes?.length) return; const first = nodes[0], last = nodes[nodes.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } }
    };
    document.addEventListener('keydown', key);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', key); previous?.focus(); };
  }, [mode, item, pending, cancelPhoto]);
  useEffect(() => {
    if (!mode && !item) return;
    const viewport = window.visualViewport, overlay = dialog.current?.parentElement;
    if (!viewport || !overlay) return;
    const resize = () => { overlay.style.setProperty('--inventory-viewport-height', `${viewport.height}px`); overlay.style.setProperty('--inventory-viewport-top', `${viewport.offsetTop}px`); };
    resize(); viewport.addEventListener('resize', resize); viewport.addEventListener('scroll', resize);
    return () => { viewport.removeEventListener('resize', resize); viewport.removeEventListener('scroll', resize); };
  }, [mode, item]);
  useEffect(() => {
    const inputs = [cameraInput.current, libraryInput.current];
    const cancel = () => { if (!photoFile.current) setPhotoStatus('No new photo selected. Your entry is unchanged.'); };
    inputs.forEach(input => input?.addEventListener('cancel', cancel));
    return () => inputs.forEach(input => input?.removeEventListener('cancel', cancel));
  }, [mode]);
  function changeFields(values: Partial<Draft>) { setDraft(d => { const next = { ...d, ...values }; if (mode === 'add') { try { sessionStorage.setItem(draftKey, JSON.stringify(next)); } catch { /* An unsaved form can still be used; exact save persistence is required separately. */ } } return next; }); }
  function change<K extends keyof Draft>(key: K, value: Draft[K]) { changeFields({ [key]: value }); }
  function addInventory() {
    if (pending) return; cancelPhoto(); setError(''); setNotice(''); setItem(null); setSelected([]);
    let next = fresh(); try { const saved = sessionStorage.getItem(draftKey); if (saved) next = { ...next, ...JSON.parse(saved) }; } catch { /* Start a clean unsaved form. */ }
    setDraft(next); setMode('add');
  }
  function openItem(i: Item) { setItem(i); setSelected(i.unit_ids); setError(''); setMode(null); }
  function edit(next: Exclude<Mode, 'add' | 'location' | null>) {
    if (!item) return;
    cancelPhoto();
    const d = fresh(); Object.assign(d, { name: item.name ?? '', category: item.category ?? '', photo_key: item.photo_key, photo_url: item.photo_url ?? null, note: item.notes, price: amount(item.expected_price_cents), cost: amount(item.purchase_total_cents), type: item.receipt_quantity === 1 ? 'single' : 'batch', product: next === 'move' && item.product_id?.startsWith('inventory-product:') ? '' : item.product_id ?? '', date: localNow(), cardCosts: Object.fromEntries((data?.items.filter(i => i.lot_id === item.lot_id) ?? []).flatMap(i => i.units.map(u => [u.id, amount(u.cost_cents)]))) });
    setDraft(d); setMode(next); setError('');
  }
  const destination = () => {
    if (!draft.location || !draft.kind) throw new Error('Choose where the inventory is and what kind of location it is.');
    return { location_id: draft.location, kind: draft.kind as 'hq' | 'store' | 'kiosk' | 'machine', machine_id: draft.kind === 'machine' ? draft.machine.trim() || null : null, product_id: draft.product.trim() || null, door_id: draft.door.trim() || null };
  };
  function command(): Pending {
    if (mode === 'location') { if (!draft.name.trim() || !draft.address.trim() || !['hq', 'store', 'kiosk'].includes(draft.kind)) throw new Error('Enter a location name, address and type.'); return { action: 'location', request_id: crypto.randomUUID(), name: draft.name.trim(), address: draft.address.trim(), inventoryKind: draft.kind as 'hq' | 'store' | 'kiosk' }; }
    const time = new Date(draft.date); if (!Number.isFinite(time.getTime()) || time > new Date()) throw new Error('Choose the actual date and time, today or earlier.');
    const meta = { request_id: crypto.randomUUID(), effective_at: time.toISOString(), note: draft.note.trim() };
    const description = { name: draft.name.trim(), category: draft.category, notes: draft.note.trim(), photo_key: draft.photo_key };
    if (mode === 'add') {
      if (!draft.origin || !draft.type) throw new Error('Choose Current stock or New purchase, then Batch or Individual card.');
      if (!description.name || !description.category || !draft.stage) throw new Error('Add a name, category and current condition.');
      const quantity = draft.type === 'single' ? 1 : Number(draft.quantity);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 2000) throw new Error('Enter a quantity from 1 to 2,000 cards.');
      const cost = cents(draft.cost);
      return { ...meta, action: 'add', origin: draft.origin as 'existing' | 'purchase', quantity, description, total_cost_cents: cost, cost_method: cost === null ? 'unassigned' : quantity === 1 ? 'documented_unit' : 'equal_card', expected_price_cents: cents(draft.price), destination: destination(), stage: draft.stage as 'unprocessed' | 'processing' | 'processed' | 'packed' };
    }
    if (!item) throw new Error('Select an inventory item first.');
    if (mode === 'count') { const quantity = Number(draft.quantity); if (!draft.quantity || !Number.isInteger(quantity) || quantity < 0 || !item.machine_scope) throw new Error('Enter the number of cards physically counted in this machine product.'); return { ...meta, action: 'count', scope: item.machine_scope, quantity }; }
    if (mode === 'cost') { const cost = cents(draft.cost); return { ...meta, action: 'cost', lot_id: item.lot_id, total_cost_cents: cost, cost_method: cost === null ? 'unassigned' : draft.costSplit === 'custom' ? 'explicit_per_card' : item.receipt_quantity === 1 ? 'documented_unit' : 'equal_card', card_costs: draft.costSplit === 'custom' ? Object.entries(draft.cardCosts).map(([unit_id, value]) => { const cost = cents(value); if (cost === null) throw new Error('Enter a cost for every card, or split the total evenly.'); return { unit_id, cost_cents: cost }; }) : null }; }
    if (!selected.length) throw new Error('Select at least one card.');
    if (mode === 'edit') return { ...meta, action: 'edit', unit_ids: selected, description, expected_price_cents: cents(draft.price) };
    if (mode === 'move') return { ...meta, action: 'move', unit_ids: selected, destination: destination(), planned: draft.planned };
    if (mode === 'prepare') { if (!draft.stage) throw new Error('Choose the new condition.'); return { ...meta, action: 'prepare', unit_ids: selected, stage: draft.stage as 'processing' | 'processed' | 'packed', product_id: draft.product || `inventory-product:${item.lot_id}` }; }
    throw new Error('Choose an action.');
  }
  async function save(retry?: Pending) {
    if (saveLock.current || photoLock.current || photoFile.current) return;
    let value: Pending;
    try { value = retry ?? command(); sessionStorage.setItem(pendingKey, JSON.stringify({ actor: adminId, command: value, ui: { mode, draft, item, selected } })); }
    catch (e) { setError(e instanceof Error ? e.message : 'Your entry could not be saved safely in this browser.'); return; }
    saveLock.current = true; setBusy(true); setPending(value); setRejected(false); setError('');
    const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 30000);
    try {
      const response = await fetch(value.action === 'location' ? '/api/admin/locations' : API, { method: 'POST', headers, body: JSON.stringify(value.action === 'location' ? { ...value, inventoryRequestId: value.request_id } : value), signal: abort.signal }); const result = await response.json();
      if (!response.ok) { if ([400, 401, 403, 409].includes(response.status)) setRejected(true); throw new Error(result.message || 'Save could not be confirmed. Retry this saved entry.'); }
      if (result.request_id !== value.request_id || !['RECORDED', 'REPLAY'].includes(result.outcome)) throw new Error('Save could not be confirmed. Retry this saved entry.');
      sessionStorage.removeItem(pendingKey); if (value.action === 'add') sessionStorage.removeItem(draftKey);
      if (!active.current) return;
      setPending(null); setMode(null); setItem(null); setDraft(fresh()); setNotice(value.action === 'location' ? 'Location added. You can now assign inventory here.' : value.action === 'add' ? 'Inventory added. Your team can now find and manage it here.' : 'Inventory updated.'); await load(); buttonRef.current?.focus();
    } catch (e) { if (active.current) setError(e instanceof Error ? e.message : 'Connection interrupted. Retry your saved entry to confirm it.'); }
    finally { clearTimeout(timer); saveLock.current = false; if (active.current) setBusy(false); }
  }
  async function photo(file: File | undefined) {
    if (!file || photoLock.current || saveLock.current || pending) return;
    const attempt = ++photoAttempt.current, controller = new AbortController();
    const current = () => active.current && attempt === photoAttempt.current;
    photoController.current = controller; photoFile.current = file; photoLock.current = true;
    setUploading(true); setPhotoError(''); setPhotoStatus('Preparing your photo…'); setPhotoPreview(null);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const prepared = await prepareStaffInventoryPhoto(file, { signal: controller.signal });
      if (!current()) return;
      setPhotoPreview(prepared.image); setPhotoStatus('Uploading your photo…');
      timer = setTimeout(() => controller.abort(), 30000);
      const response = await fetch('/api/v2/admin/inventory/photo', { method: 'POST', headers, body: JSON.stringify({ image: prepared.image }), signal: controller.signal }); const value = await response.json();
      if (!current()) return;
      if (!response.ok || typeof value.photo_key !== 'string' || !value.photo_key || typeof value.photo_url !== 'string' || !value.photo_url) throw new Error(value.message || 'The photo did not upload. Please try again.');
      changeFields({ photo_key: value.photo_key, photo_url: value.photo_url });
      photoFile.current = null; setPhotoPreview(null); setPhotoStatus('Photo ready. Save your entry to attach it.');
    } catch (e) { if (current()) { setPhotoStatus(''); setPhotoError(controller.signal.aborted ? 'The photo upload took too long. Retry when your connection is ready.' : e instanceof Error ? e.message : 'The photo did not upload. Please try again.'); } }
    finally { clearTimeout(timer); if (current()) { photoLock.current = false; photoController.current = null; setUploading(false); } }
  }
  function choosePhoto(source: 'camera' | 'library') {
    if (photoLock.current || saveLock.current || pending) return;
    const input = source === 'camera' ? cameraInput.current : libraryInput.current;
    if (input) { input.value = ''; if (!photoError) setPhotoStatus(source === 'camera' ? 'If your camera is unavailable, choose a photo from your library.' : ''); input.click(); }
  }
  const items = (data?.items ?? []).filter(i => (!location || i.location_id === location) && (!category || i.category === category) && (!query || [i.name, i.category, i.location_name, i.notes].some(v => v?.toLowerCase().includes(query.toLowerCase()))));
  const categories = [...new Set((data?.items ?? []).flatMap(i => i.category ? [i.category] : []))];
  const close = () => { if (!saveLock.current && !pending) { cancelPhoto(); setMode(null); setItem(null); setError(''); } };
  const retryControls = pending && <div className={styles.pending}><strong>{rejected ? 'Your entry needs a change.' : 'Finish your last save'}</strong><p>{rejected ? 'Nothing from this attempt was added. Edit the entry or retry after signing in.' : 'Retry the saved entry to confirm it. This will not add a second copy.'}</p><button type="button" disabled={busy} className={styles.primary} onClick={() => void save(pending)}>{busy ? 'Saving…' : 'Retry saved entry'}</button>{rejected && <button type="button" className={styles.secondary} disabled={busy} onClick={() => { sessionStorage.removeItem(pendingKey); setPending(null); setRejected(false); }}>Edit entry</button>}</div>;
  const locationFields = <>
    <Field label={mode === 'move' ? 'Destination' : 'Current location'}><select required value={draft.location} onChange={e => { change('location', e.target.value); const l = data?.locations.find(l => l.id === e.target.value); change('kind', l?.locationType && ['hq', 'store', 'kiosk', 'machine'].includes(l.locationType) ? l.locationType : ''); }}><option value="">Choose a location</option>{data?.locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
    <Field label="Location type"><select required value={draft.kind} onChange={e => change('kind', e.target.value)}><option value="">Choose type</option><option value="hq">HQ / storage</option><option value="store">Store</option><option value="kiosk">Kiosk</option><option value="machine">Vending machine</option></select></Field>
    {draft.kind === 'machine' && <><Field label="Machine number" help="Use the number on the machine’s sticker."><input required list="inventory-machines" value={draft.machine} onChange={e => change('machine', e.target.value)} /><datalist id="inventory-machines">{data?.machines.filter(m => m.location_id === draft.location).map((m, i) => <option key={i} value={m.machine_id} />)}</datalist></Field><Field label="Machine product number" help="Use the product number from this machine’s sales records. The selected cards will be assigned to this product."><input required value={draft.product} onChange={e => change('product', e.target.value)} /></Field><Field label="Door / slot (optional)"><input value={draft.door} onChange={e => change('door', e.target.value)} /></Field></>}
  </>;
  const descriptionFields = <>
    <div className={styles.photoField}>
      <div className={styles.photoUpload} aria-busy={uploading}>{photoPreview || draft.photo_url ? <img src={photoPreview || draft.photo_url!} alt={photoPreview ? 'New inventory photo' : 'Inventory photo'} /> : <Icon name="photo" size={30} />}<span>{draft.photo_url || photoPreview ? 'Your inventory photo' : 'Add a photo'}<small>Optional · private to your team</small></span></div>
      <div className={styles.photoControls}>
        <button type="button" className={styles.secondary} disabled={uploading || busy || !!pending} onClick={() => choosePhoto('camera')}><Icon name="photo" />Take photo</button>
        <button type="button" className={styles.secondary} disabled={uploading || busy || !!pending} onClick={() => choosePhoto('library')}><Icon name="library" />Choose photo</button>
        <input ref={cameraInput} className={styles.srOnly} tabIndex={-1} aria-label="Take inventory photo" aria-describedby="inventory-photo-help" type="file" accept={STAFF_INVENTORY_PHOTO_ACCEPT} capture="environment" disabled={uploading || busy || !!pending} onChange={e => { const file = e.currentTarget.files?.[0]; e.currentTarget.value = ''; void photo(file); }} />
        <input ref={libraryInput} className={styles.srOnly} tabIndex={-1} aria-label="Choose inventory photo" aria-describedby="inventory-photo-help" type="file" accept={STAFF_INVENTORY_PHOTO_ACCEPT} disabled={uploading || busy || !!pending} onChange={e => { const file = e.currentTarget.files?.[0]; e.currentTarget.value = ''; void photo(file); }} />
      </div>
      <p id="inventory-photo-help" className={styles.helper}>iPhone HEIC / HEIF, JPG, PNG or WebP.</p>
      {photoStatus && <p role="status" className={styles.photoStatus}>{photoStatus}</p>}
      {uploading && <button type="button" className={styles.photoCancel} onClick={() => cancelPhoto(draft.photo_key ? 'Your current photo is unchanged.' : 'Photo cancelled. Your other details are still here.')}>Cancel photo</button>}
      {photoError && <div className={styles.photoError}><p role="alert">{photoError} Your other details are still here.</p><div><button type="button" className={styles.secondary} onClick={() => void photo(photoFile.current ?? undefined)}>Retry photo</button><button type="button" className={styles.photoCancel} onClick={() => cancelPhoto(draft.photo_key ? 'Your current photo is unchanged.' : 'Continue with your entry. You can add a photo later.')}>{draft.photo_key ? 'Keep current photo' : 'Continue without photo'}</button></div></div>}
    </div>
    <Field label={draft.type === 'single' || mode === 'edit' && selected.length === 1 ? 'Card name' : 'Inventory name'}><input required autoComplete="off" maxLength={160} value={draft.name} onChange={e => change('name', e.target.value)} /></Field>
    <Field label="Category"><select required value={draft.category} onChange={e => change('category', e.target.value)}><option value="">Choose a category</option>{[...new Set(['Sports cards', 'Pokémon', 'Other trading cards', ...categories])].map(c => <option key={c}>{c}</option>)}</select></Field>
  </>;
  let previewProfit: number | null = null, previewMargin: number | null = null, previewOverflow = false;
  try { const cost = cents(draft.cost), price = cents(draft.price), quantity = draft.type === 'single' ? 1 : Number(draft.quantity); if (cost !== null && price !== null && quantity > 0) { const sales = price * quantity; previewOverflow = !Number.isSafeInteger(sales) || !Number.isSafeInteger(sales - cost); if (!previewOverflow) { previewProfit = sales - cost; previewMargin = price > 0 ? previewProfit / sales * 100 : null; } } } catch { /* A malformed amount receives an inline save error. */ }
  return <div className={styles.workspace}>
    <aside className={styles.sidebar}><Link href="/admin" className={styles.brand}><svg className={styles.crown} width="32" height="30" viewBox="0 0 32 30" fill="none" aria-hidden="true"><path d="m3 8 7 6 6-11 6 11 7-6-3 15H6L3 8Z" stroke="currentColor" strokeWidth="1.5"/><path d="M7 27h18" stroke="currentColor" strokeWidth="1.5"/></svg><span>TEN KINGS<small>TEAM WORKSPACE</small></span></Link><div className={styles.navLabel}>WORKSPACE</div><button className={tab === 'inventory' ? styles.navActive : styles.nav} onClick={() => setTab('inventory')}><Icon name="box" />Inventory</button><button className={tab === 'locations' ? styles.navActive : styles.nav} onClick={() => setTab('locations')}><Icon name="pin" />Locations</button><div className={styles.sidebarBottom}><button className={styles.nav} onClick={onAdvanced}>Advanced records<Icon name="chevron" size={15} /></button><Link className={styles.nav} href="/admin"><Icon name="back" />Admin home</Link><div className={styles.person}><span>{(displayName || 'TK').slice(0, 2).toUpperCase()}</span><div>{displayName || 'Ten Kings team'}<small>Inventory access</small></div></div></div></aside>
    <main className={styles.main}>
      <div className={styles.topline}><span>OPERATIONS <i>/</i> {tab === 'locations' ? 'LOCATIONS' : 'INVENTORY'}</span><span className={styles.saved}><i />{error ? 'Connection needs attention' : data ? 'Team inventory' : 'Connecting…'}</span></div>
      <header className={styles.header}><div><p className={styles.eyebrow}>EVERY CARD. ONE PLACE.</p><h1>{tab === 'locations' ? 'Your locations' : 'Inventory'}</h1><p>{tab === 'locations' ? 'See what is recorded at each Ten Kings location.' : 'Add stock, give it a home, and keep your team in sync.'}</p></div><div className={styles.headerActions}>{tab === 'locations' && <button className={styles.secondary} disabled={!!pending || !data} onClick={() => { setMode('location'); setDraft(fresh()); setItem(null); setError(''); }}>Add location</button>}<button ref={buttonRef} className={styles.primary} onClick={addInventory} disabled={!!pending || !data}><Icon name="plus" />Add inventory</button></div></header>
      {!mode && !item && <>{error && <div role="alert" className={styles.error}>{error}<button onClick={() => { setError(''); void load(); }}>Try again</button></div>}{notice && <div role="status" className={styles.success}><Icon name="check" />{notice}</div>}{retryControls}</>}
      <section className={styles.stats} aria-label="Inventory overview"><div><span>Recorded on hand</span><strong>{data?.totals.on_hand.toLocaleString() ?? '—'}<small>cards</small></strong><p>{data?.totals.machine_roster ? `${data.totals.machine_roster.toLocaleString()} additional cards in machine loading records` : 'At HQ, stores and kiosks'}</p></div><div><span>Acquisition cost</span><strong>{money(data?.totals.cost_cents)}</strong><p>{data?.totals.value_overflow ? 'Total exceeds supported range' : data?.totals.on_hand ? `${data.totals.costed_units} of ${data.totals.on_hand} held cards have a cost` : 'Enter costs when you add stock'}</p></div><div><span>Expected gross profit</span><strong className={data?.totals.expected_profit_cents != null && data.totals.expected_profit_cents < 0 ? styles.loss : styles.profit}>{money(data?.totals.expected_profit_cents)}</strong><p>{data?.totals.expected_margin_pct != null ? `${data.totals.expected_margin_pct.toFixed(1)}% margin · before fees & overhead` : 'Expected sale price less acquisition cost'}</p></div></section>
      {tab === 'inventory' ? <section className={styles.panel}>
        <div className={styles.panelHeading}><h2>All inventory <span>{data?.items.length ?? '—'}</span></h2><button className={styles.iconButton} aria-label="Refresh inventory" onClick={() => void load()}><Icon name="refresh" size={18} /></button></div>
        {!!data?.items.length && <div className={styles.filters}><label className={styles.search}><Icon name="search" size={18} /><input aria-label="Search inventory" placeholder="Search inventory" value={query} onChange={e => setQuery(e.target.value)} /></label><select aria-label="Filter by location" value={location} onChange={e => setLocation(e.target.value)}><option value="">All locations</option>{data.locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select><select aria-label="Filter by category" value={category} onChange={e => setCategory(e.target.value)}><option value="">All categories</option>{categories.map(c => <option key={c}>{c}</option>)}</select></div>}
        {!data ? <div className={styles.empty}><span className={styles.emptyIcon}><Icon name="box" size={36} /></span><h3>Loading your inventory…</h3></div> : !data.items.length ? <div className={styles.empty}><span className={styles.emptyIcon}><Icon name="box" size={42} /></span><span className={styles.eyebrow}>LET’S GET YOUR STOCK ORGANIZED</span><h3>Your inventory starts here.</h3><p>Add the cards you already have or record a new purchase.<br />Start with one card or an entire batch.</p><button className={styles.primary} onClick={addInventory} disabled={!!pending}><Icon name="plus" />Add your first inventory</button><div className={styles.emptySteps}><span><b>1</b>Add your cards</span><span><b>2</b>Set cost & price</span><span><b>3</b>Choose a location</span></div></div> : !items.length ? <div className={styles.empty}><h3>No matching inventory</h3><p>Try another name or clear your filters.</p><button className={styles.secondary} onClick={() => { setQuery(''); setLocation(''); setCategory(''); }}>Clear filters</button></div> : <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Inventory</th><th>Location</th><th>Quantity</th><th>Cost</th><th>Expected sale</th><th>Expected profit</th><th><span className={styles.srOnly}>Open item</span></th></tr></thead><tbody>{items.map(i => <tr key={i.id}><td><button className={styles.itemButton} onClick={() => openItem(i)}><span className={styles.thumb}>{i.photo_url ? <img src={i.photo_url} alt="" /> : <Icon name="cards" size={25} />}</span><span><strong>{i.name || 'Unnamed inventory'}</strong><small>{i.category || 'Category not set'} <i>·</i> {stageNames[i.stage]}</small></span></button></td><td data-label="Location"><span className={styles.locationName}>{i.location_name || 'Location not named'}</span><small>{i.custody_id.startsWith('machine:') ? 'Vending machine' : i.custody_id.startsWith('store:') ? 'Store' : i.custody_id.startsWith('kiosk:') ? 'Kiosk' : 'HQ / storage'}</small></td><td data-label="Quantity"><strong>{i.quantity.toLocaleString()}</strong><small>{i.quantity_kind === 'loaded_roster' ? 'loaded · count needed' : i.quantity === 1 ? 'card on hand' : 'cards on hand'}</small></td><td data-label="Cost">{money(i.cost_cents)}<small>{i.value_overflow ? 'Total exceeds supported range' : i.cost_cents === null ? 'Cost not fully entered' : 'Total cost'}</small></td><td data-label="Expected sale">{money(i.expected_price_cents)}<small>per card</small></td><td data-label="Expected profit" className={i.expected_profit_cents !== null && i.expected_profit_cents < 0 ? styles.loss : styles.profit}>{money(i.expected_profit_cents)}<small>{i.expected_margin_pct === null ? 'Price or cost not set' : `${i.expected_margin_pct.toFixed(1)}% margin`}</small></td><td><button className={styles.iconButton} aria-label={`Open ${i.name || 'inventory'}`} onClick={() => openItem(i)}><Icon name="chevron" /></button></td></tr>)}</tbody></table></div>}
      </section> : <StaffInventoryLocationBrowser locations={data?.locations ?? []} items={data?.items ?? []} token={token} onViewInventory={id => { setLocation(id); setCategory(''); setQuery(''); setTab('inventory'); }} />}
      <footer className={styles.footer}><button className={styles.mobileAdvanced} onClick={onAdvanced}>Advanced records</button><span>Staff records are saved securely in Ten Kings.</span><span>{data?.updated_at ? `Latest activity ${new Date(data.updated_at).toLocaleString()}` : 'Ready for your first entry'}</span></footer>
    </main>
    {(mode || item) && <div className={styles.overlay} onMouseDown={e => { if (e.target === e.currentTarget) close(); }}><div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="inventory-dialog-title" className={styles.drawer}>
      <div className={styles.drawerHeader}><div><span className={styles.eyebrow}>{mode === 'add' ? 'BUILD YOUR INVENTORY' : 'INVENTORY DETAILS'}</span><h2 id="inventory-dialog-title">{mode === 'add' ? 'Add inventory' : mode === 'edit' ? 'Edit selected cards' : mode === 'move' ? 'Move inventory' : mode === 'prepare' ? 'Update condition' : mode === 'cost' ? 'Update purchase cost' : mode === 'count' ? 'Record machine count' : mode === 'location' ? 'Add location' : item?.name || 'Inventory details'}</h2></div><button className={styles.iconButton} aria-label="Close inventory details" disabled={busy || !!pending} onClick={close}><Icon name="close" /></button></div>
      {error && <div role="alert" className={styles.error}>{error}</div>}{retryControls}
      {mode ? <form onSubmit={e => { e.preventDefault(); void save(); }}><fieldset disabled={busy || !!pending} className={styles.formBody}>
        {mode === 'location' && <section className={styles.formSection}><Field label="Location name"><input required value={draft.name} onChange={e => change('name', e.target.value)} /></Field><Field label="Street address"><input required value={draft.address} onChange={e => change('address', e.target.value)} /></Field><Field label="Location type"><select required value={draft.kind} onChange={e => change('kind', e.target.value)}><option value="">Choose a type</option><option value="hq">HQ / storage</option><option value="store">Store</option><option value="kiosk">Kiosk</option></select></Field><p className={styles.helper}>HQ and storage locations are private to your team. Use an existing venue location when assigning stock to a vending machine.</p></section>}
        {mode === 'add' && <><div className={styles.choiceGrid}>{[['existing', 'Current stock', 'Cards your company already owns.'], ['purchase', 'New purchase', 'Cards you have just received.']].map(([key, title, help]) => <button type="button" key={key} className={draft.origin === key ? styles.choiceSelected : styles.choice} onClick={() => change('origin', key)}><Icon name={key === 'existing' ? 'box' : 'plus'} /><strong>{title}</strong><small>{help}</small></button>)}</div><div className={styles.segment} aria-label="Inventory type">{[['batch', 'Batch of cards'], ['single', 'Individual card']].map(([key, name]) => <button type="button" key={key} aria-pressed={draft.type === key} onClick={() => change('type', key)}>{name}</button>)}</div></>}
        {(mode === 'add' || mode === 'edit') && <section className={styles.formSection}><h3>{mode === 'add' ? '1. What are you adding?' : `${selected.length} selected ${selected.length === 1 ? 'card' : 'cards'}`}</h3>{descriptionFields}{mode === 'add' && draft.type === 'batch' && <Field label="Number of cards"><input required type="number" inputMode="numeric" min="1" max="2000" step="1" value={draft.quantity} onChange={e => change('quantity', e.target.value)} /></Field>}</section>}
        {(mode === 'add' || mode === 'move') && <section className={styles.formSection}><h3>{mode === 'add' ? '2. Where is it?' : `Move ${selected.length} selected ${selected.length === 1 ? 'card' : 'cards'}`}</h3><div className={styles.formGrid}>{locationFields}</div>{mode === 'move' && <label className={styles.checkbox}><input type="checkbox" checked={draft.planned} onChange={e => change('planned', e.target.checked)} /><span>Plan this move for later<small>Leave unchecked if the cards have already arrived.</small></span></label>}{mode === 'add' && <Field label="Current condition"><select required value={draft.stage} onChange={e => change('stage', e.target.value)}><option value="">Choose the condition you see</option>{Object.entries(stageNames).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>}</section>}
        {(mode === 'add' || mode === 'edit' || mode === 'cost') && <section className={styles.formSection}><h3>{mode === 'add' ? '3. Cost & expected price' : mode === 'cost' ? 'Purchase cost' : 'Expected selling price'}</h3><div className={styles.formGrid}>{mode !== 'edit' && <Field label={draft.type === 'single' ? 'Card acquisition cost' : 'Total batch acquisition cost'} help={draft.type === 'single' ? 'What you paid. Leave blank if unknown.' : mode === 'cost' && draft.costSplit === 'custom' ? 'The total paid for every card in the original purchase.' : `This total is divided equally across ${mode === 'cost' ? item?.receipt_quantity : draft.quantity || 'the'} cards. Leave blank if unknown.`}><div className={styles.currencyInput}><span>$</span><input inputMode="decimal" value={draft.cost} onChange={e => change('cost', e.target.value)} /></div></Field>}{mode !== 'cost' && <Field label="Expected sale price per card" help="Your planned price. Leave blank if not decided."><div className={styles.currencyInput}><span>$</span><input inputMode="decimal" value={draft.price} onChange={e => change('price', e.target.value)} /></div></Field>}</div>{mode === 'add' && <div className={styles.profitPreview}><div><span>Expected gross profit</span><strong>{money(previewProfit)}</strong></div><div><span>Expected margin</span><strong>{previewMargin === null ? '—' : `${previewMargin.toFixed(1)}%`}</strong></div><small>{previewOverflow ? 'The expected total exceeds the supported calculation range.' : 'Based on selling every card at your entered price. Before fees and overhead.'}</small></div>}{mode === 'cost' && item && item.receipt_quantity > 1 && <><Field label="How should the batch cost be split?"><select value={draft.costSplit} onChange={e => change('costSplit', e.target.value)}><option value="equal">Split evenly across every card</option><option value="custom">Enter a different cost for each card</option></select></Field>{draft.costSplit === 'custom' && <div className={styles.cardCosts}>{(data?.items.filter(i => i.lot_id === item.lot_id) ?? []).flatMap(i => i.units.map(u => <Field key={u.id} label={`Card ${u.number} · ${i.name || 'Unnamed card'}`}><div className={styles.currencyInput}><span>$</span><input inputMode="decimal" value={draft.cardCosts[u.id] ?? ''} onChange={e => change('cardCosts', { ...draft.cardCosts, [u.id]: e.target.value })} /></div></Field>))}<p className={styles.helper}>All card costs must add up to the total batch cost above.</p></div>}</>}{mode === 'cost' && <p className={styles.helper}>This updates the acquisition cost of the entire original purchase ({item?.receipt_quantity} cards), including cards moved to other locations. The original entry stays in history.</p>}</section>}
        {mode === 'count' && <section className={styles.formSection}><Field label="Cards physically counted" help="Count this product across the selected machine scope, including all loading batches."><input required type="number" min="0" step="1" inputMode="numeric" value={draft.quantity} onChange={e => change('quantity', e.target.value)} /></Field><p className={styles.helper}>{item?.location_name} · machine {item?.machine_scope?.machine_id} · product {item?.machine_scope?.product_id}{item?.machine_scope?.door_id ? ` · slot ${item.machine_scope.door_id}` : ' · all slots'}</p><p className={styles.helper}>This records what staff counted at the time below. It does not guess which individual cards sold.</p></section>}
        {mode === 'prepare' && <section className={styles.formSection}><Field label="New condition"><select required value={draft.stage} onChange={e => change('stage', e.target.value)}><option value="">Choose completed work</option><option value="processing">Being prepared</option><option value="processed">Ready to pack</option><option value="packed">Packed — one card per pack</option></select></Field><Field label="Product"><select value={draft.product} onChange={e => change('product', e.target.value)}><option value="">{item?.name || 'This inventory'}</option>{data?.products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><p className={styles.helper}>Record work that has actually been completed. Packing keeps each card’s purchase cost attached.</p></section>}
        {mode !== 'location' && <section className={styles.formSection}><Field label={mode === 'add' ? 'Count / receipt date and time' : 'Date and time'}><input required type="datetime-local" value={draft.date} max={localNow()} onChange={e => change('date', e.target.value)} /></Field><Field label={mode === 'cost' ? 'Receipt reference / reason' : 'Notes or receipt reference (optional)'}><textarea rows={3} maxLength={1600} value={draft.note} onChange={e => change('note', e.target.value)} /></Field></section>}
      </fieldset><div className={styles.drawerFooter}>{(uploading || photoError) && <p className={styles.footerPhotoStatus} role="status">{uploading ? photoStatus : 'Retry the photo or choose how to continue above.'}</p>}<button type="button" className={styles.secondary} disabled={busy || !!pending} onClick={close}>Cancel</button><button type="submit" className={styles.primary} disabled={busy || uploading || !!photoError || !!pending}>{busy ? 'Saving…' : uploading ? 'Preparing photo…' : mode === 'add' ? 'Add inventory' : mode === 'location' ? 'Add location' : mode === 'move' ? draft.planned ? 'Save planned move' : 'Save move' : 'Save changes'}<Icon name="arrow" size={18} /></button></div></form> : item && <div className={styles.itemDetail}>
        <div className={styles.detailHero}>{item.photo_url ? <img src={item.photo_url} alt={item.name || 'Inventory'} /> : <Icon name="cards" size={65} />}<span>{item.category || 'Category not set'}</span></div>
        <div className={styles.detailFacts}><div><span>Location</span><strong>{item.location_name || 'Not named'}</strong></div><div><span>Condition</span><strong>{stageNames[item.stage]}</strong></div><div><span>{item.quantity_kind === 'loaded_roster' ? 'Loaded roster' : 'On hand'}</span><strong>{item.quantity} cards</strong></div><div><span>Acquisition cost</span><strong>{money(item.cost_cents)}</strong></div><div><span>Expected sale / card</span><strong>{money(item.expected_price_cents)}</strong></div><div><span>Expected gross profit</span><strong className={styles.profit}>{money(item.expected_profit_cents)}</strong></div></div>
        {item.quantity_kind === 'loaded_roster' && <p className={styles.helper}>This is a machine’s loading record. A physical count is needed to establish what remains; individual sold cards are not identified by aggregate sales.</p>}
        {item.last_count && <p className={styles.helper}>Last physical count for this machine product: <strong>{item.last_count.quantity} cards</strong> on {new Date(item.last_count.at).toLocaleString()}.</p>}
        <div className={styles.detailActions}>{item.machine_scope && <button className={styles.primary} disabled={!!pending} onClick={() => edit('count')}>Record machine count</button>}<button className={styles.primary} disabled={!selected.length || !!pending} onClick={() => edit('edit')}>Edit details & price</button><button className={styles.secondary} disabled={!selected.length || !!pending || item.quantity_kind === 'loaded_roster'} onClick={() => edit('move')}><Icon name="pin" size={18} />Move / assign</button><button className={styles.secondary} disabled={!selected.length || !!pending || item.quantity_kind === 'loaded_roster'} onClick={() => edit('prepare')}>Update condition</button><button className={styles.secondary} disabled={!!pending} onClick={() => edit('cost')}>Edit purchase cost</button></div>
        <div className={styles.rosterTitle}><h3>Cards in this group</h3><span>{selected.length} selected</span><button onClick={() => setSelected(selected.length === item.unit_ids.length ? [] : item.unit_ids)}>{selected.length === item.unit_ids.length ? 'Deselect all' : 'Select all'}</button></div><p className={styles.helper}>Select one card to give it its own name, photo or price. Select several to move or update them together.</p>
        <div className={styles.roster}>{item.units.map(u => <label key={u.id}><input type="checkbox" checked={selected.includes(u.id)} onChange={e => setSelected(s => e.target.checked ? [...s, u.id] : s.filter(id => id !== u.id))} /><span>Card {u.number}<small>{u.planned_location_name ? `Planned: ${u.planned_location_name}` : u.permanent_card_id ? 'Linked graded card' : stageNames[item.stage]}</small></span><strong>{money(u.cost_cents)}<small>acquisition cost</small></strong></label>)}</div>
        {item.notes && <p className={styles.detailNotes}>{item.notes}</p>}<details className={styles.history}><summary>Record details</summary><p>Added {new Date(item.created_at).toLocaleString()} · {item.origin === 'existing' ? 'Current stock' : 'New purchase'}</p><p>Source references</p>{Object.entries(item.provenance).map(([k, v]) => v && <p key={k}>{k}: {v}</p>)}<button className={styles.secondary} onClick={onAdvanced}>Open advanced records</button></details>
      </div>}
    </div></div>}
  </div>;
}
