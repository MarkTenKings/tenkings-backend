/* eslint-disable @next/next/no-img-element */
import { Children, cloneElement, createContext, isValidElement, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode, type ReactElement } from 'react';
import { flushSync } from 'react-dom';
import Link from 'next/link';
import type { StaffInventoryCommand, StaffInventoryWorkspace as Workspace } from '@tenkings/database';
import { prepareStaffInventoryPhoto, STAFF_INVENTORY_PHOTO_ACCEPT } from '../../lib/inventoryPhotoUpload';
import { saveStaffInventoryPhoto } from '../../lib/staffInventoryPhotoRequest';
import StaffInventoryLocationBrowser from './StaffInventoryLocationBrowser';
import { createStaffInventoryPointCache, parseStaffInventoryMapPointResponse, type StaffInventoryMapLocation } from '../../lib/staffInventoryLocationsMap';
import StaffInventoryCardCapture from './StaffInventoryCardCapture';
import StaffInventoryResearchPanel from './StaffInventoryResearchPanel';
import { StaffInventoryMarketValueResponseSchema, type StaffInventoryMarketValueSummary } from '../../lib/staffInventoryMarketValue';
import { isStaffInventoryIdentificationResponse } from '../../lib/staffInventoryIdentification';
import { createStaffInventoryLocator, staffInventoryLocationKind } from '../../lib/staffInventoryGeolocation';
import { readStaffInventoryPosition } from '../../lib/staffInventoryBrowserPosition';
import styles from './StaffInventoryWorkspace.module.css';

type Item = Workspace['items'][number] & { photo_url?: string | null; back_photo_url?: string | null };
type Data = Omit<Workspace, 'items' | 'locations'> & { items: Item[]; locations: StaffInventoryMapLocation[] };
type Mode = 'add' | 'edit' | 'move' | 'prepare' | 'cost' | 'count' | 'location' | null;
type Pending = StaffInventoryCommand | { action: 'location'; request_id: string; name: string; address: string; inventoryKind: 'hq' | 'store' | 'kiosk' };
type PhotoSide = 'front' | 'back';
type UploadedPhoto = { photo_key: string; photo_url: string };
type SideUploadResult = { ok: true; photo: UploadedPhoto } | { ok: false };
type SideUpload = { file: File; uploadId: string; controller: AbortController; promise: Promise<SideUploadResult>; result?: SideUploadResult };
type PricingStep = 'cost' | 'channel' | null;
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
const cardFields = ['manufacturer', 'card_number', 'year', 'set_name', 'variant', 'card_type'] as const;
const cardFieldLabels: Record<typeof cardFields[number], string> = { manufacturer: 'Manufacturer', card_number: 'Card number', year: 'Year', set_name: 'Set / product', variant: 'Parallel / variant', card_type: 'Card type' };
const salesChannels = ['Vending machines', 'Stores', 'Kiosks', 'Ten Kings online', 'eBay', 'Whatnot', 'Amazon'];
const fresh = () => ({ origin: 'existing', type: 'single', name: '', category: '', quantity: '', cost: '', price: '', salesChannel: '', location: '', kind: '', machine: '', product: '', door: '', stage: 'unprocessed', date: localNow(), note: '', photo_key: null as string | null, photo_url: null as string | null, back_photo_key: null as string | null, back_photo_url: null as string | null, manufacturer: '', card_number: '', year: '', set_name: '', variant: '', card_type: '', address: '', loadedConfirmed: false, planned: false, costSplit: 'equal', cardCosts: {} as Record<string, string> });
type Draft = ReturnType<typeof fresh>;
type MarketEntry = { summary: StaffInventoryMarketValueSummary | null; unavailable: boolean; refreshAt: number };
const researchBinding = (item: Item) => item.receipt_quantity === 1 && item.unit_ids.length === 1 && item.provenance.description
  ? [item.unit_ids[0], item.provenance.description] as const : null;
const marketKey = (binding: readonly [string, string]) => JSON.stringify(binding);

function useInventoryMarketValues(scope: string, token: string, bindings: string, paused: boolean, reviewBinding: string | null) {
  const [visible, setVisible] = useState(true), [revision, setRevision] = useState(0);
  const [view, setView] = useState<{ scope: string; entries: Record<string, MarketEntry> }>({ scope, entries: {} });
  const cache = useRef({ scope, entries: new Map<string, MarketEntry>() });
  const request = useRef<AbortController | null>(null);
  const current = useRef({ scope, paused }); current.current = { scope, paused: paused || !visible };
  useEffect(() => {
    const changed = () => { if (document.hidden) request.current?.abort(); setVisible(!document.hidden); };
    changed(); document.addEventListener('visibilitychange', changed);
    return () => document.removeEventListener('visibilitychange', changed);
  }, []);
  useEffect(() => {
    if (cache.current.scope !== scope) cache.current = { scope, entries: new Map() };
    // A deliberate drawer review can start/retry research. Refresh that card when the list resumes.
    if (reviewBinding) {
      cache.current.entries.delete(reviewBinding);
      setView(previous => { if (previous.scope !== scope || !previous.entries[reviewBinding]) return previous;
        const entries = { ...previous.entries }; delete entries[reviewBinding]; return { scope, entries }; });
    }
    if (paused || !visible || !bindings) return;
    const pairs = JSON.parse(bindings) as [string, string][];
    let stopped = false, timer: ReturnType<typeof setTimeout> | undefined, readTimeout: ReturnType<typeof setTimeout> | undefined;
    const valid = () => !stopped && current.current.scope === scope && !current.current.paused && !document.hidden;
    async function read() {
      const due = pairs.filter(pair => (cache.current.entries.get(marketKey(pair))?.refreshAt ?? 0) <= Date.now());
      for (let offset = 0; offset < due.length && valid();) {
        const params = new URLSearchParams({ view: 'summary' }), chunk: [string, string][] = [];
        while (offset < due.length && chunk.length < 50) {
          const next = new URLSearchParams(params); next.append('unit_id', due[offset][0]);
          if (chunk.length && next.toString().length > 5900) break;
          params.append('unit_id', due[offset][0]); chunk.push(due[offset++]);
        }
        const ids = new Set(chunk.map(pair => pair[0]));
        const controller = new AbortController(); request.current = controller;
        const timeout = setTimeout(() => controller.abort(), 15000); readTimeout = timeout;
        try {
          const response = await fetch(`/api/v2/admin/inventory/research?${params}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal });
          const parsed = StaffInventoryMarketValueResponseSchema.safeParse(await response.json());
          if (!response.ok || !parsed.success || new Set(parsed.data.summaries.map(summary => summary.unit_id)).size !== parsed.data.summaries.length
            || parsed.data.summaries.some(summary => !ids.has(summary.unit_id))) throw new Error('Invalid market summary');
          if (!valid()) return;
          if (controller.signal.aborted) throw new Error('Market summary timed out');
          for (const pair of chunk) {
            const summary = parsed.data.summaries.find(value => value.unit_id === pair[0]);
            const matches = summary?.description_event_id === pair[1];
            cache.current.entries.set(marketKey(pair), { summary: matches ? summary! : null, unavailable: !!summary && !matches,
              refreshAt: matches && ['queued', 'running'].includes(summary.status) ? Date.now() + 30000 : Infinity });
          }
        } catch {
          if (!valid()) return;
          chunk.forEach(pair => cache.current.entries.set(marketKey(pair), { summary: null, unavailable: true, refreshAt: Infinity }));
        } finally { clearTimeout(timeout); if (request.current === controller) request.current = null; }
        if (valid()) setView({ scope, entries: Object.fromEntries(cache.current.entries) });
      }
      if (!valid()) return;
      const next = Math.min(...pairs.map(pair => cache.current.entries.get(marketKey(pair))?.refreshAt ?? Infinity));
      if (Number.isFinite(next)) timer = setTimeout(() => void read(), Math.max(1000, next - Date.now()));
    }
    void read();
    return () => { stopped = true; clearTimeout(timer); clearTimeout(readTimeout); request.current?.abort(); };
  }, [scope, token, bindings, paused, visible, reviewBinding, revision]);
  return { entries: view.scope === scope ? view.entries : {}, refresh: () => { cache.current = { scope, entries: new Map() }; setView({ scope, entries: {} }); setRevision(value => value + 1); } };
}
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
const FieldErrors = createContext<Record<string, string>>({});
function Field({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  const error = useContext(FieldErrors)[label], errorId = useId();
  const nameControl = (nodes: ReactNode): ReactNode => Children.map(nodes, node => {
    if (!isValidElement(node)) return node;
    const el = node as ReactElement<{ children?: ReactNode; 'aria-label'?: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }>;
    return ['input', 'select', 'textarea'].includes(String(el.type)) ? cloneElement(el, { 'aria-label': label, 'aria-invalid': !!error, 'aria-describedby': error ? errorId : undefined }) : el.props.children ? cloneElement(el, {}, nameControl(el.props.children)) : el;
  });
  return <label className={styles.field}><span>{label}</span>{nameControl(children)}{error && <small id={errorId} className={styles.fieldError}>{error}</small>}{help && <small>{help}</small>}</label>;
}

export default function StaffInventoryWorkspace({ token, adminId, displayName, onAdvanced, navigation }: { token: string; adminId: string; displayName?: string | null; onAdvanced: () => void; navigation?: { homeHref: string; homeLabel: string } }) {
  const scope = JSON.stringify([adminId, token]), session = useRef(scope); session.current = scope;
  const workspaceRequest = useRef<AbortController | null>(null);
  const [workspace, setWorkspace] = useState<{ scope: string; data: Data } | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const data = workspace?.scope === scope ? workspace.data : null;
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [tab, setTab] = useState('inventory'), [query, setQuery] = useState(''), [location, setLocation] = useState(''), [category, setCategory] = useState(''), [salesChannel, setSalesChannel] = useState('');
  const [item, setItem] = useState<Item | null>(null), [selected, setSelected] = useState<string[]>([]), [mode, setMode] = useState<Mode>(null), [draft, setDraft] = useState<Draft>(fresh);
  const [researchFocus, setResearchFocus] = useState(false), researchSection = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false), [uploading, setUploading] = useState(false), [pending, setPending] = useState<Pending | null>(null), [rejected, setRejected] = useState(false);
  const [photoStatus, setPhotoStatus] = useState(''), [photoError, setPhotoError] = useState(''), [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [autoStartCamera, setAutoStartCamera] = useState(true);
  const aiFields = useRef(new Set<keyof Draft>());
  const [captureOpen, setCaptureOpen] = useState(false), [captureCycle, setCaptureCycle] = useState(0), [captureSource, setCaptureSource] = useState<'camera' | 'library'>('camera');
  const [capturePricing, setCapturePricing] = useState(false), [pricingStep, setPricingStep] = useState<PricingStep>(null);
  const captureVisible = captureOpen && !capturePricing;
  const [identityError, setIdentityError] = useState(''), [identityNotes, setIdentityNotes] = useState<string[]>([]), [locationStatus, setLocationStatus] = useState('');
  const pairFiles = useRef<[File, File] | null>(null), editedFields = useRef<Record<string, number>>({}), locationRevision = useRef(0), geoAttempt = useRef(0), geoController = useRef<AbortController | null>(null);
  const sideUploads = useRef<Partial<Record<PhotoSide, SideUpload>>>({}), pairProcessing = useRef(false);
  const draftRef = useRef(draft); draftRef.current = draft;
  const autoLocation = useRef(false), locationUpdatedAt = useRef(0);
  const sessionLocation = useRef({ location: '', kind: '' });
  const locator = useRef<ReturnType<typeof createStaffInventoryLocator> | null>(null);
  const pointCache = useRef(createStaffInventoryPointCache());
  const form = useRef<HTMLFormElement>(null);
  const costInput = useRef<HTMLInputElement>(null), channelChoices = useRef<HTMLFieldSetElement>(null);
  const modalState = useRef({ captureVisible, pending }); modalState.current = { captureVisible, pending };
  const dialog = useRef<HTMLDivElement>(null), active = useRef(true), saveLock = useRef(false), buttonRef = useRef<HTMLButtonElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null), libraryInput = useRef<HTMLInputElement>(null), photoFile = useRef<File | null>(null);
  const photoAttempt = useRef(0), photoLock = useRef(false), photoController = useRef<AbortController | null>(null);
  const cancelLocation = useCallback(() => { geoAttempt.current++; geoController.current?.abort(); }, []);
  const releasePhotoAttempt = useCallback(() => {
    photoAttempt.current++; photoController.current?.abort(); photoController.current = null; photoFile.current = null; pairFiles.current = null; photoLock.current = false;
    Object.values(sideUploads.current).forEach(upload => upload?.controller.abort()); sideUploads.current = {}; pairProcessing.current = false;
  }, []);
  const cancelPhoto = useCallback((message = '') => {
    releasePhotoAttempt(); setUploading(false); setPhotoError(''); setPhotoStatus(message); setPhotoPreview(null); setIdentityError('');
    setCaptureOpen(false); setCapturePricing(false);
  }, [releasePhotoAttempt]);
  const pendingKey = `tenkings:staff-inventory:pending:${adminId}`, draftKey = `tenkings:staff-inventory:draft:${adminId}`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  async function load() {
    if (session.current !== scope) return;
    workspaceRequest.current?.abort(); const controller = new AbortController(); workspaceRequest.current = controller;
    try {
      const response = await fetch(API, { headers, cache: 'no-store', signal: controller.signal }); const value = await response.json();
      if (!response.ok) throw new Error(value.message || 'Inventory is temporarily unavailable.');
      if (value.version !== 1 || !Array.isArray(value.items) || !Array.isArray(value.locations)) throw new Error('Inventory returned an unreadable response.');
      if (active.current && session.current === scope && !controller.signal.aborted) { setWorkspace({ scope, data: value }); if (!dialog.current) setError(''); }
    } catch (e) { if (active.current && session.current === scope && !controller.signal.aborted) setError(e instanceof Error ? e.message : 'Inventory could not be loaded.'); }
    finally { if (workspaceRequest.current === controller) workspaceRequest.current = null; }
  }
  useEffect(() => {
    active.current = true; locator.current = null; void load();
    try { const saved = sessionStorage.getItem(pendingKey); if (saved) { const value = JSON.parse(saved); if (value.actor !== adminId || !value.command?.request_id) throw new Error(); setPending(value.command); if (value.ui) { setDraft({ ...fresh(), ...value.ui.draft }); setMode(value.ui.mode); setItem(value.ui.item); setSelected(value.ui.selected ?? []); } setNotice('Your last save needs confirmation. Retry it below to finish without adding a duplicate.'); } } catch { setError('Your last saved request could not be read. Keep this tab open and contact your administrator.'); }
    return () => { active.current = false; workspaceRequest.current?.abort(); releasePhotoAttempt(); cancelLocation(); };
  // Accounts remount this component; refreshed tokens must also refresh lookup authorization.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminId, token]);
  useEffect(() => { if (mode || busy || pending) return; const timer = setInterval(() => { if (!document.hidden) void load(); }, 10000); return () => clearInterval(timer); });
  useEffect(() => {
    if (!mode && !item) return;
    const previous = document.activeElement as HTMLElement | null, previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.querySelector<HTMLElement>('button, input, select, textarea')?.focus();
    const key = (e: KeyboardEvent) => {
      if (modalState.current.captureVisible) return;
      if (e.key === 'Escape' && !saveLock.current && !modalState.current.pending) { cancelPhoto(); cancelLocation(); setMode(null); setItem(null); }
      if (e.key === 'Tab') { const candidates = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled):not([tabindex="-1"]), select:not(:disabled), textarea:not(:disabled), a[href], summary'); const nodes = [...(candidates ?? [])].filter(node => !node.closest('[hidden]') && (!node.closest('details:not([open])') || node.tagName === 'SUMMARY')); if (!nodes.length) return; const first = nodes[0], last = nodes[nodes.length - 1]; if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); } }
    };
    document.addEventListener('keydown', key);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', key); previous?.focus(); };
  }, [mode, item, cancelPhoto, cancelLocation]);
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
  function changeFields(values: Partial<Draft>) { setDraft(d => { const next = { ...d, ...values }; if (mode === 'add') { try { sessionStorage.setItem(draftKey, JSON.stringify({ ...next, manuallyEditedFields: Object.keys(editedFields.current).filter(key => editedFields.current[key] > 0), automaticallyReadFields: [...aiFields.current], autoSelectedLocation: autoLocation.current, autoLocationUpdatedAt: locationUpdatedAt.current })); } catch { /* An unsaved form can still be used; exact save persistence is required separately. */ } } return next; }); }
  function change<K extends keyof Draft>(key: K, value: Draft[K]) { setFieldErrors({}); if (!pending) setError(''); aiFields.current.delete(key); editedFields.current[key] = (editedFields.current[key] ?? 0) + 1; if (key === 'location' || key === 'kind') { locationRevision.current++; cancelLocation(); } changeFields({ [key]: value }); }
  function addInventory() {
    if (pending) return; cancelPhoto(); setPricingStep(null); setIdentityNotes([]); editedFields.current = {}; aiFields.current.clear(); setError(''); setFieldErrors({}); setNotice(''); setItem(null); setSelected([]);
    let next = { ...fresh(), ...sessionLocation.current }; try { const saved = sessionStorage.getItem(draftKey); if (saved) { const stored = JSON.parse(saved); autoLocation.current = stored.autoSelectedLocation === true; locationUpdatedAt.current = Number.isFinite(stored.autoLocationUpdatedAt) ? stored.autoLocationUpdatedAt : 0; next = { ...next, ...stored, price: '', origin: stored.origin || 'existing', type: stored.type || 'single', stage: stored.stage || 'unprocessed' }; const restoredFields = Array.isArray(stored.manuallyEditedFields) ? stored.manuallyEditedFields : ['name', 'category', ...cardFields].filter(key => stored[key]); editedFields.current = Object.fromEntries(restoredFields.map((key: string) => [key, 1])); aiFields.current = new Set((Array.isArray(stored.automaticallyReadFields) ? stored.automaticallyReadFields : []).filter((key: keyof Draft) => !editedFields.current[key])); } } catch { /* Start a clean unsaved form. */ }
    sessionLocation.current = { location: next.location, kind: next.kind }; setDraft(next); setMode('add');
  }
  function openItem(i: Item, focusResearch = false) { setResearchFocus(focusResearch); setItem(i); setSelected(i.unit_ids); setError(''); setMode(null); }
  function edit(next: Exclude<Mode, 'add' | 'location' | null>) {
    if (!item) return;
    cancelPhoto();
    const d = fresh(); Object.assign(d, { name: item.name ?? '', category: item.category ?? '', photo_key: item.photo_key, photo_url: item.photo_url ?? null, note: item.notes, price: amount(item.expected_price_cents), salesChannel: item.planned_sales_channel ?? '', cost: amount(item.purchase_total_cents), type: item.receipt_quantity === 1 ? 'single' : 'batch', product: next === 'move' && item.product_id?.startsWith('inventory-product:') ? '' : item.product_id ?? '', date: localNow(), cardCosts: Object.fromEntries((data?.items.filter(i => i.lot_id === item.lot_id) ?? []).flatMap(i => i.units.map(u => [u.id, amount(u.cost_cents)]))) });
    d.back_photo_key = item.back_photo_key ?? null; d.back_photo_url = item.back_photo_url ?? null;
    for (const field of cardFields) d[field] = item.card_details?.[field] ?? '';
    setIdentityNotes([]); editedFields.current = {}; aiFields.current.clear();
    setDraft(d); setMode(next); setError(''); setFieldErrors({});
  }
  const destination = () => {
    if (!draft.location || !draft.kind) throw new Error('Choose where the inventory is and what kind of location it is.');
    return { location_id: draft.location, kind: draft.kind as 'hq' | 'store' | 'kiosk' | 'machine', machine_id: draft.kind === 'machine' ? draft.machine.trim() || null : null, product_id: draft.product.trim() || null, door_id: draft.door.trim() || null };
  };
  function command(): Pending {
    if (mode === 'location') { if (!draft.name.trim() || !draft.address.trim() || !['hq', 'store', 'kiosk'].includes(draft.kind)) throw new Error('Enter a location name, address and type.'); return { action: 'location', request_id: crypto.randomUUID(), name: draft.name.trim(), address: draft.address.trim(), inventoryKind: draft.kind as 'hq' | 'store' | 'kiosk' }; }
    const time = new Date(draft.date); if (!Number.isFinite(time.getTime()) || time > new Date()) throw new Error('Choose the actual date and time, today or earlier.');
    const meta = { request_id: crypto.randomUUID(), effective_at: time.toISOString(), note: draft.note.trim() };
    const description = { name: draft.name.trim(), category: draft.category, notes: draft.note.trim(), planned_sales_channel: draft.salesChannel || null, photo_key: draft.photo_key, ...(draft.back_photo_key ? { back_photo_key: draft.back_photo_key } : {}), ...(cardFields.some(key => draft[key].trim()) ? { card_details: Object.fromEntries(cardFields.map(key => [key, draft[key].trim() || null])) as Record<typeof cardFields[number], string | null> } : {}) };
    if (mode === 'add') {
      if (!description.name || !description.category) throw new Error('Add the card name and category, or take clear front and back photos.');
      const quantity = draft.type === 'single' ? 1 : Number(draft.quantity);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 2000) throw new Error('Enter a quantity from 1 to 2,000 cards.');
      const cost = cents(draft.cost);
      if (draft.kind === 'machine' && (!draft.loadedConfirmed || draft.origin !== 'existing')) throw new Error('Confirm these cards are already packed inside this machine. Receive a new purchase at HQ, a store or a kiosk first.');
      return { ...meta, action: 'add', origin: draft.origin as 'existing' | 'purchase', quantity, description, total_cost_cents: cost, cost_method: cost === null ? 'unassigned' : quantity === 1 ? 'documented_unit' : 'equal_card', expected_price_cents: null, destination: destination(), stage: draft.kind === 'machine' ? 'packed' : draft.stage as 'unprocessed' | 'processing' | 'processed' | 'packed' };
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
  function validateEntry() {
    const errors: Record<string, string> = {};
    let first: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | undefined;
    for (const control of form.current?.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea') ?? []) {
      if (!control.willValidate) continue;
      const label = control.getAttribute('aria-label') || control.closest('label')?.textContent?.trim() || 'This field';
      let message = '';
      if (control.validity.valueMissing || control.required && !control.value.trim()) message = control.type === 'checkbox' ? 'Confirm these cards are already packed and loaded inside this machine.' : `${control.tagName === 'SELECT' ? 'Choose' : 'Enter'} ${label.toLowerCase()}.`;
      else if (control.type === 'datetime-local' && (!control.validity.valid || !Number.isFinite(new Date(control.value).getTime()) || new Date(control.value) > new Date())) message = 'Choose the actual date and time, today or earlier.';
      else if (!control.validity.valid) message = `${label}: ${control.validationMessage}`;
      else if (control.getAttribute('inputmode') === 'decimal') { try { cents(control.value); } catch (e) { message = e instanceof Error ? e.message : 'Enter a valid amount.'; } }
      if (message) {
        errors[label] = message; first ??= control;
        let parent = control.parentElement;
        while (parent) { if (parent.tagName === 'DETAILS') (parent as HTMLDetailsElement).open = true; parent = parent.parentElement; }
      }
    }
    setFieldErrors(errors);
    if (!first) return true;
    setError(Object.keys(errors).length === 1 ? errors[first.getAttribute('aria-label') || first.closest('label')?.textContent?.trim() || 'This field'] : `Complete ${Object.keys(errors).length} highlighted fields to save this entry.`);
    first.focus({ preventScroll: true }); first.scrollIntoView?.({ block: 'center', behavior: 'auto' });
    return false;
  }
  async function save(retry?: Pending) {
    if (saveLock.current) return;
    if (photoLock.current || photoFile.current || pairFiles.current) { setError('Finish or cancel the photo step before saving this entry.'); return; }
    if (!retry && !validateEntry()) return;
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
      setPending(null); setItem(null); cancelPhoto(); setPricingStep(null); setFieldErrors({}); setIdentityNotes([]); editedFields.current = {}; aiFields.current.clear();
      if (value.action === 'add' && value.quantity === 1) {
        sessionLocation.current = { location: value.destination.location_id, kind: value.destination.kind };
        setDraft({ ...fresh(), ...sessionLocation.current, origin: value.origin }); setMode('add'); setAutoStartCamera(false); setCaptureSource('camera'); setCaptureCycle(cycle => cycle + 1); setCaptureOpen(true);
        setNotice('Card added. Ready for the next card.');
      } else { setMode(null); setDraft(fresh()); setNotice(value.action === 'location' ? 'Location added. You can now assign inventory here.' : value.action === 'add' ? 'Inventory added.' : 'Inventory updated.'); buttonRef.current?.focus(); }
      void load();
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
  async function locateInventory(retry = false) {
    if (!data || mode !== 'add') return;
    if (!retry && draftRef.current.location && (!autoLocation.current || Date.now() - locationUpdatedAt.current < 300000)) return;
    const previousLocation = { ...sessionLocation.current };
    if (autoLocation.current) { changeFields({ location: '', kind: '' }); sessionLocation.current = { location: '', kind: '' }; }
    const attempt = ++geoAttempt.current, revision = locationRevision.current;
    geoController.current?.abort(); const controller = new AbortController(); geoController.current = controller;
    setLocationStatus('Finding your location…');
    if (!locator.current) locator.current = createStaffInventoryLocator({
      getPosition: signal => readStaffInventoryPosition({ signal, onProgress: message => { if (active.current && !signal.aborted) setLocationStatus(message); } }),
      pointCache: pointCache.current,
      resolvePoint: async (id, signal) => {
        const response = await fetch(`/api/v2/admin/inventory/location-map?location_id=${encodeURIComponent(id)}`, { headers, signal, cache: 'no-store' });
        if (!response.ok) return null; return parseStaffInventoryMapPointResponse(id, await response.json());
      },
    });
    const result = await locator.current(data.locations, controller.signal, retry, progress => { if (active.current && !controller.signal.aborted && attempt === geoAttempt.current && revision === locationRevision.current) setLocationStatus(progress.message); });
    if (!active.current || controller.signal.aborted || attempt !== geoAttempt.current || revision !== locationRevision.current) return;
    setLocationStatus(result.message);
    if (result.location) {
      const kind = (previousLocation.location === result.location.id ? previousLocation.kind : '') || staffInventoryLocationKind(result.location, data.items);
      autoLocation.current = true; locationUpdatedAt.current = Date.now();
      changeFields({ location: result.location.id, kind }); sessionLocation.current = { location: result.location.id, kind };
      if (!kind) setLocationStatus(`${result.message} Choose its inventory type once for this session.`);
    }
  }
  useEffect(() => { if (captureOpen && mode === 'add') void locateInventory();
  // Capture cycles refresh expired automatic locations; manual selections remain staff-owned.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captureOpen, captureCycle, mode]);
  function startCapture(source: 'camera' | 'library') {
    if (photoLock.current || saveLock.current || pending) return;
    cancelPhoto(); setPricingStep(null); setIdentityNotes([]); setAutoStartCamera(true); setCaptureSource(source); setCaptureCycle(cycle => cycle + 1); setCaptureOpen(true);

  }
  function beginPricing() {
    // Flush visibility on the shutter's user activation, before any toBlob/fetch.
    // A visible Next control also works when a device does not open its keyboard.
    flushSync(() => { setCapturePricing(true); setPricingStep('cost'); });
    costInput.current?.focus({ preventScroll: true });
    costInput.current?.scrollIntoView?.({ block: 'center', behavior: 'auto' });
  }
  function advancePricing() {
    if (pricingStep !== 'cost') return;
    const control = costInput.current;
    const label = 'Card acquisition cost';
    try { cents(control?.value ?? ''); }
    catch (failure) {
      const message = failure instanceof Error ? failure.message : 'Enter a valid amount.';
      setFieldErrors({ [label]: message }); setError(message); control?.focus(); return;
    }
    flushSync(() => { setFieldErrors({}); setError(''); setPricingStep('channel'); });
    const next = channelChoices.current?.querySelector<HTMLInputElement>('input:checked') ?? channelChoices.current?.querySelector<HTMLInputElement>('input');
    next?.focus({ preventScroll: true }); next?.scrollIntoView?.({ block: 'center', behavior: 'auto' });
  }
  async function readCardIdentity(front: string, back: string, controller: AbortController, attempt: number) {
    const timer = setTimeout(() => controller.abort(), 75000);
    try {
      setPhotoStatus('Reading the front and back… You can enter the cost and choose a sales channel now.');
      const response = await fetch('/api/v2/admin/inventory/identify', { method: 'POST', headers, signal: controller.signal, body: JSON.stringify({ front_photo_key: front, back_photo_key: back }) });
      const result = await response.json();
      if (!active.current || attempt !== photoAttempt.current || controller.signal.aborted) return;
      if (!response.ok || !isStaffInventoryIdentificationResponse(result, { front_photo_key: front, back_photo_key: back })) throw new Error('Card details could not be read. Enter them below or retry identification.');
      const values: Partial<Draft> = {}, review: string[] = [];
      for (const field of ['name', 'category', ...cardFields] as const) {
        const suggestion = result.suggestions[field];
        if (!suggestion || typeof suggestion.value !== 'string' || !suggestion.value.trim() || !['high', 'medium'].includes(suggestion.confidence)) continue;
        if ((editedFields.current[field] ?? 0) > 0) continue;
        values[field] = suggestion.value.trim(); aiFields.current.add(field);
        if (suggestion.confidence === 'medium') review.push(field === 'name' ? 'card name' : field === 'category' ? 'category' : cardFieldLabels[field].toLowerCase());
      }
      changeFields(values); setIdentityError('');
      setIdentityNotes([review.length ? `Double-check ${review.join(', ')}.` : 'Details read from your photos. Check them before saving.', ...(Array.isArray(result.warnings) ? result.warnings.filter((warning: unknown): warning is string => typeof warning === 'string').slice(0, 3) : [])]);
      setPhotoStatus('Both photos are ready.');
    } catch {
      if (active.current && attempt === photoAttempt.current) { setPhotoStatus('Both photos are ready.'); setIdentityError('Card details could not be read. Enter them below or retry identification.'); }
    } finally { clearTimeout(timer); }
  }
  function uploadSide(side: PhotoSide, file: File, retryFailed = false): Promise<SideUploadResult> {
    const previous = sideUploads.current[side];
    if (previous?.file === file && (!retryFailed || previous.result?.ok !== false)) return previous.promise;
    previous?.controller.abort();
    const attempt = photoAttempt.current, controller = new AbortController();
    const job: SideUpload = { file, uploadId: previous?.file === file ? previous.uploadId : crypto.randomUUID(), controller, promise: Promise.resolve({ ok: false }) };
    sideUploads.current[side] = job;
    photoLock.current = true; setUploading(true);
    job.promise = (async (): Promise<SideUploadResult> => {
      const current = () => active.current && attempt === photoAttempt.current && sideUploads.current[side] === job && !controller.signal.aborted;
      try {
        const prepared = await prepareStaffInventoryPhoto(file, { signal: controller.signal });
        if (!current()) return { ok: false };
        const photo = await saveStaffInventoryPhoto({ image: prepared.image, uploadId: job.uploadId, headers, signal: controller.signal });
        return current() ? { ok: true, photo } : { ok: false };
      } catch { return { ok: false }; }
    })().then(result => { job.result = result; return result; });
    return job.promise;
  }
  async function pairCaptured(front: File, back: File, retryFailed = false) {
    if (pairProcessing.current || saveLock.current || pending) return;
    const attempt = photoAttempt.current, controller = new AbortController();
    const current = () => active.current && attempt === photoAttempt.current && !controller.signal.aborted;
    if (mode === 'add' && pricingStep === null) beginPricing();
    setCaptureOpen(false); setCapturePricing(false); pairFiles.current = [front, back]; pairProcessing.current = true; photoLock.current = true; photoController.current = controller;
    setUploading(true); setPhotoError(''); setIdentityError(''); setIdentityNotes([]); setPhotoStatus('Saving both photos… You can enter the cost and choose a sales channel now.');
    try {
      const uploads = await Promise.all([uploadSide('front', front, retryFailed), uploadSide('back', back, retryFailed)]);
      if (!current()) return;
      if (!uploads[0].ok || !uploads[1].ok) throw new Error('Both photos must finish uploading. Please retry.');
      const [frontPhoto, backPhoto] = [uploads[0].photo, uploads[1].photo];
      const cleared: Partial<Draft> = {}; for (const field of aiFields.current) { if (!editedFields.current[field] && typeof draftRef.current[field] === 'string') Object.assign(cleared, { [field]: '' }); } aiFields.current.clear();
      changeFields({ ...cleared, photo_key: frontPhoto.photo_key, photo_url: frontPhoto.photo_url, back_photo_key: backPhoto.photo_key, back_photo_url: backPhoto.photo_url }); pairFiles.current = null;
      await readCardIdentity(frontPhoto.photo_key, backPhoto.photo_key, controller, attempt);
    } catch {
      if (current()) { setPhotoStatus(''); setPhotoError('Both photos could not be saved. Retry the photos, or keep entering this card manually.'); }
    } finally { if (active.current && attempt === photoAttempt.current) { pairProcessing.current = false; photoLock.current = false; photoController.current = null; setUploading(false); } }
  }
  async function retryIdentity() {
    if (photoLock.current || !draft.photo_key || !draft.back_photo_key) return;
    const attempt = ++photoAttempt.current, controller = new AbortController(); photoController.current = controller; photoLock.current = true; setUploading(true); setIdentityError('');
    await readCardIdentity(draft.photo_key, draft.back_photo_key, controller, attempt);
    if (active.current && attempt === photoAttempt.current) { photoLock.current = false; photoController.current = null; setUploading(false); }
  }
  const items = (data?.items ?? []).filter(i => (!location || i.location_id === location) && (!category || i.category === category) && (!salesChannel || (salesChannel === '__unset' ? !i.planned_sales_channel : i.planned_sales_channel === salesChannel.slice(8))) && (!query || [i.name, i.category, i.location_name, i.notes, i.planned_sales_channel].some(v => v?.toLowerCase().includes(query.toLowerCase()))));
  const bindings = JSON.stringify([...new Map(items.flatMap(i => { const binding = researchBinding(i); return binding ? [[binding[0], binding] as const] : []; })).values()]);
  const reviewItem = item && data?.items.find(current => current.id === item.id);
  const reviewBinding = reviewItem ? researchBinding(reviewItem) : null;
  const market = useInventoryMarketValues(scope, token, bindings, tab !== 'inventory' || !!mode || !!item || busy || uploading || captureOpen || !!pending,
    reviewBinding ? marketKey(reviewBinding) : null);
  useEffect(() => {
    if (!mode && item && researchFocus) { researchSection.current?.focus({ preventScroll: true }); researchSection.current?.scrollIntoView?.({ block: 'start', behavior: 'auto' }); }
  }, [mode, item, researchFocus]);
  function marketValue(i: Item) {
    if (i.receipt_quantity !== 1 || i.unit_ids.length !== 1) return <span className={styles.marketState}>Individual card research</span>;
    const binding = researchBinding(i), entry = binding ? market.entries[marketKey(binding)] : undefined;
    const summary = entry?.summary;
    const label = !binding || entry?.unavailable ? 'Unavailable' : !entry ? 'Checking value…' : !summary ? 'Not researched'
      : summary.status === 'estimated' ? money(summary.value_cents) : summary.status === 'queued' ? 'Queued'
        : summary.status === 'running' ? 'Researching…' : summary.status === 'failed' ? 'Unavailable' : 'More evidence needed';
    return <button type="button" className={styles.marketButton} aria-label={`Review eBay comps for ${i.name || 'inventory'}: ${label}`} onClick={() => openItem(i, true)}>
      <strong>{label}</strong><small>{summary?.status === 'estimated' ? `${summary.comp_count} comps · Review` : 'Review research'}</small>
    </button>;
  }
  const categories = [...new Set((data?.items ?? []).flatMap(i => i.category ? [i.category] : []))];
  const channelOptions = [...new Set([...salesChannels, ...(data?.items ?? []).flatMap(i => i.planned_sales_channel ? [i.planned_sales_channel] : []), ...(draft.salesChannel ? [draft.salesChannel] : [])])];
  const close = () => { if (!saveLock.current && !pending) { cancelPhoto(); cancelLocation(); setCaptureOpen(false); setMode(null); setItem(null); setError(''); } };
  const retryControls = pending && <div className={styles.pending}><strong>{rejected ? 'Your entry needs a change.' : 'Finish your last save'}</strong><p>{rejected ? 'Nothing from this attempt was added. Edit the entry or retry after signing in.' : 'Retry the saved entry to confirm it. This will not add a second copy.'}</p><button type="button" disabled={busy} className={styles.primary} onClick={() => void save(pending)}>{busy ? 'Saving…' : 'Retry saved entry'}</button>{rejected && <button type="button" className={styles.secondary} disabled={busy} onClick={() => { sessionStorage.removeItem(pendingKey); setPending(null); setRejected(false); }}>Edit entry</button>}</div>;
  const locationFields = <>
    <Field label={mode === 'move' ? 'Destination' : 'Current location'}><select required value={draft.location} onChange={e => { autoLocation.current = false; change('location', e.target.value); const l = data?.locations.find(l => l.id === e.target.value); const kind = l ? staffInventoryLocationKind(l, data?.items ?? []) : ''; change('kind', kind); sessionLocation.current = { location: e.target.value, kind }; setLocationStatus('Using your selected location for this session.'); }}><option value="">Choose a location</option>{data?.locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></Field>
    <Field label="Location type"><select required value={draft.kind} onChange={e => { change('kind', e.target.value); sessionLocation.current = { location: draft.location, kind: e.target.value }; }}><option value="">Choose type</option><option value="hq">HQ / storage</option><option value="store">Store</option><option value="kiosk">Kiosk</option><option value="machine">Vending machine</option></select></Field>
    {draft.kind === 'machine' && <>{mode === 'add' && <label className={styles.checkbox}><input type="checkbox" required aria-label="Loaded machine confirmation" aria-invalid={!!fieldErrors["Loaded machine confirmation"]} checked={draft.loadedConfirmed} onChange={e => change('loadedConfirmed', e.target.checked)} />These cards are already packed and loaded inside this machine.</label>}<Field label="Machine number" help="Use the number on the machine’s sticker."><input required list="inventory-machines" value={draft.machine} onChange={e => change('machine', e.target.value)} /><datalist id="inventory-machines">{data?.machines.filter(m => m.location_id === draft.location).map((m, i) => <option key={i} value={m.machine_id} />)}</datalist></Field><Field label="Machine product number" help="Use the product number from this machine’s sales records. The selected cards will be assigned to this product."><input required value={draft.product} onChange={e => change('product', e.target.value)} /></Field><Field label="Door / slot (optional)"><input value={draft.door} onChange={e => change('door', e.target.value)} /></Field></>}
  </>;
  const fastCardPhoto = mode === 'add' && draft.type === 'single' || mode === 'edit' && selected.length === 1;
  const guidedPricing = mode === 'add' && draft.type === 'single' && pricingStep !== null;
  const descriptionFields = <>
    {fastCardPhoto ? <div className={styles.photoField}>
      <div className={styles.pairPreview}>{[['Front', draft.photo_url], ['Back', draft.back_photo_url]].map(([side, url]) => <div key={side}>{url ? <img src={url} alt={`${side} of inventory card`} /> : <Icon name="cards" size={32} />}<span>{side}</span></div>)}</div>
      <div className={styles.photoControls}><button type="button" className={styles.primary} disabled={uploading || busy || !!pending} onClick={() => startCapture('camera')}><Icon name="photo" />{draft.photo_key && draft.back_photo_key ? 'Retake photos' : 'Take photo'}</button><button type="button" className={styles.secondary} disabled={uploading || busy || !!pending} onClick={() => startCapture('library')}><Icon name="library" />Choose photos</button></div>
      <p className={styles.helper}>Front, then back. We read the card details for you. HEIC / HEIF supported.</p>
      {photoStatus && <p role="status" className={styles.photoStatus}>{photoStatus}</p>}
      {uploading && <button type="button" className={styles.photoCancel} onClick={() => cancelPhoto('You can enter the card details below.')}>Continue manually</button>}
      {photoError && <div className={styles.photoError}><p role="alert">{photoError}</p><div><button type="button" className={styles.secondary} onClick={() => { const pair = pairFiles.current; if (pair) void pairCaptured(...pair, true); }}>Retry photos</button><button type="button" className={styles.photoCancel} onClick={() => cancelPhoto('Your saved photos and other details are unchanged.')}>Keep current photos</button></div></div>}
      {identityError && <div className={styles.photoError}><p role="alert">{identityError}</p><button type="button" className={styles.secondary} disabled={uploading} onClick={() => void retryIdentity()}>Retry identification</button></div>}
      {!!identityNotes.length && <div className={styles.identityNotes} role="status">{identityNotes.map((note, index) => <p key={index}>{note}</p>)}</div>}
    </div> : <div className={styles.photoField}>
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
    </div>}
    <Field label={draft.type === 'single' || mode === 'edit' && selected.length === 1 ? 'Card name' : 'Inventory name'}><input required autoComplete="off" maxLength={160} value={draft.name} onChange={e => change('name', e.target.value)} /></Field>
    <Field label="Category"><select required value={draft.category} onChange={e => change('category', e.target.value)}><option value="">Choose a category</option>{[...new Set(['Sports cards', 'Pokémon', 'Other trading cards', ...categories])].map(c => <option key={c}>{c}</option>)}</select></Field>
    <details className={styles.cardMetadata}><summary>Card details <span>{[draft.year, draft.manufacturer, draft.card_number ? `#${draft.card_number}` : ''].filter(Boolean).join(' · ') || 'Manufacturer, year, number & more'}</span></summary><div className={styles.formGrid}>{cardFields.map(field => <Field key={field} label={cardFieldLabels[field]}><input autoComplete="off" maxLength={field === 'year' ? 20 : field === 'card_number' ? 80 : 160} value={draft[field]} onChange={e => change(field, e.target.value)} /></Field>)}</div></details>
  </>;
  return <div className={styles.workspace}>
    <aside className={styles.sidebar}><Link href={navigation?.homeHref ?? "/admin"} className={styles.brand}><svg className={styles.crown} width="32" height="30" viewBox="0 0 32 30" fill="none" aria-hidden="true"><path d="m3 8 7 6 6-11 6 11 7-6-3 15H6L3 8Z" stroke="currentColor" strokeWidth="1.5"/><path d="M7 27h18" stroke="currentColor" strokeWidth="1.5"/></svg><span>TEN KINGS<small>TEAM WORKSPACE</small></span></Link><div className={styles.navLabel}>WORKSPACE</div><button className={tab === 'inventory' ? styles.navActive : styles.nav} onClick={() => setTab('inventory')}><Icon name="box" />Inventory</button><button className={tab === 'locations' ? styles.navActive : styles.nav} onClick={() => setTab('locations')}><Icon name="pin" />Locations</button><div className={styles.sidebarBottom}><button className={styles.nav} onClick={onAdvanced}>Advanced records<Icon name="chevron" size={15} /></button><Link className={styles.nav} href={navigation?.homeHref ?? "/admin"}><Icon name="back" />{navigation?.homeLabel ?? "Admin home"}</Link><div className={styles.person}><span>{(displayName || 'TK').slice(0, 2).toUpperCase()}</span><div>{displayName || 'Ten Kings team'}<small>Inventory access</small></div></div></div></aside>
    <main className={styles.main}>
      <div className={styles.topline}><span>OPERATIONS <i>/</i> {tab === 'locations' ? 'LOCATIONS' : 'INVENTORY'}</span><span className={styles.saved}><i />{error ? 'Connection needs attention' : data ? 'Team inventory' : 'Connecting…'}</span></div>
      <header className={styles.header}><div><p className={styles.eyebrow}>EVERY CARD. ONE PLACE.</p><h1>{tab === 'locations' ? 'Your locations' : 'Inventory'}</h1><p>{tab === 'locations' ? 'See what is recorded at each Ten Kings location.' : 'Add stock, give it a home, and keep your team in sync.'}</p></div><div className={styles.headerActions}>{tab === 'locations' && <button className={styles.secondary} disabled={!!pending || !data} onClick={() => { setMode('location'); setDraft(fresh()); setItem(null); setError(''); setFieldErrors({}); }}>Add location</button>}<button ref={buttonRef} className={styles.primary} onClick={addInventory} disabled={!!pending || !data}><Icon name="plus" />Add inventory</button></div></header>
      {!mode && !item && <>{error && <div role="alert" className={styles.error}>{error}<button onClick={() => { setError(''); void load(); }}>Try again</button></div>}{notice && <div role="status" className={styles.success}><Icon name="check" />{notice}</div>}{retryControls}</>}
      <section className={styles.stats} aria-label="Inventory overview"><div><span>Recorded on hand</span><strong>{data?.totals.on_hand.toLocaleString() ?? '—'}<small>cards</small></strong><p>{data?.totals.machine_roster ? `${data.totals.machine_roster.toLocaleString()} additional cards in machine loading records` : 'At HQ, stores and kiosks'}</p></div><div><span>Acquisition cost</span><strong>{money(data?.totals.cost_cents)}</strong><p>{data?.totals.value_overflow ? 'Total exceeds supported range' : data?.totals.on_hand ? `${data.totals.costed_units} of ${data.totals.on_hand} held cards have a cost` : 'Enter costs when you add stock'}</p></div><div><span>Expected gross profit</span><strong className={data?.totals.expected_profit_cents != null && data.totals.expected_profit_cents < 0 ? styles.loss : styles.profit}>{money(data?.totals.expected_profit_cents)}</strong><p>{data?.totals.expected_margin_pct != null ? `${data.totals.expected_margin_pct.toFixed(1)}% margin · before fees & overhead` : 'Expected sale price less acquisition cost'}</p></div></section>
      {tab === 'inventory' ? <section className={styles.panel}>
        <div className={styles.panelHeading}><h2>All inventory <span>{data?.items.length ?? '—'}</span></h2><button className={styles.iconButton} aria-label="Refresh inventory" onClick={() => { market.refresh(); void load(); }}><Icon name="refresh" size={18} /></button></div>
        {!!data?.items.length && <div className={styles.filters}><label className={styles.search}><Icon name="search" size={18} /><input aria-label="Search inventory" placeholder="Search inventory" value={query} onChange={e => setQuery(e.target.value)} /></label><select aria-label="Filter by location" value={location} onChange={e => setLocation(e.target.value)}><option value="">All locations</option>{data.locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select><select aria-label="Filter by category" value={category} onChange={e => setCategory(e.target.value)}><option value="">All categories</option>{categories.map(c => <option key={c}>{c}</option>)}</select><select aria-label="Filter by sales channel" value={salesChannel} onChange={e => setSalesChannel(e.target.value)}><option value="">All sales channels</option><option value="__unset">Not decided yet</option>{channelOptions.map(c => <option key={c} value={`channel:${c}`}>{c}</option>)}</select></div>}
        {!data ? <div className={styles.empty}><span className={styles.emptyIcon}><Icon name="box" size={36} /></span><h3>Loading your inventory…</h3></div> : !data.items.length ? <div className={styles.empty}><span className={styles.emptyIcon}><Icon name="box" size={42} /></span><span className={styles.eyebrow}>LET’S GET YOUR STOCK ORGANIZED</span><h3>Your inventory starts here.</h3><p>Add the cards you already have or record a new purchase.<br />Start with one card or an entire batch.</p><button className={styles.primary} onClick={addInventory} disabled={!!pending}><Icon name="plus" />Add your first inventory</button><div className={styles.emptySteps}><span><b>1</b>Add your cards</span><span><b>2</b>Enter cost</span><span><b>3</b>Choose a sales channel</span></div></div> : !items.length ? <div className={styles.empty}><h3>No matching inventory</h3><p>Try another name or clear your filters.</p><button className={styles.secondary} onClick={() => { setQuery(''); setLocation(''); setCategory(''); setSalesChannel(''); }}>Clear filters</button></div> : <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Inventory</th><th>Location</th><th>Quantity</th><th>Cost</th><th>Expected sale / card</th><th className={styles.marketHeading}>eBay comp value</th><th>Expected profit</th><th><span className={styles.srOnly}>Open item</span></th></tr></thead><tbody>{items.map(i => <tr key={i.id}><td><button className={styles.itemButton} onClick={() => openItem(i)}><span className={styles.thumb}>{i.photo_url ? <img src={i.photo_url} alt="" /> : <Icon name="cards" size={25} />}</span><span><strong>{i.name || 'Unnamed inventory'}</strong><small>{i.category || 'Category not set'} <i>·</i> {stageNames[i.stage]}</small></span></button></td><td data-label="Location"><span className={styles.locationName}>{i.location_name || 'Location not named'}</span><small>{i.custody_id.startsWith('machine:') ? 'Vending machine' : i.custody_id.startsWith('store:') ? 'Store' : i.custody_id.startsWith('kiosk:') ? 'Kiosk' : 'HQ / storage'}</small></td><td data-label="Quantity"><strong>{i.quantity.toLocaleString()}</strong><small>{i.quantity_kind === 'loaded_roster' ? 'loaded · count needed' : i.quantity === 1 ? 'card on hand' : 'cards on hand'}</small></td><td data-label="Cost">{money(i.cost_cents)}<small>{i.value_overflow ? 'Total exceeds supported range' : i.cost_cents === null ? 'Cost not fully entered' : 'Total cost'}</small></td><td data-label="Expected sale / card">{money(i.expected_price_cents)}<small>{i.planned_sales_channel || 'Sales channel not set'}</small></td><td data-label="eBay comp value" className={styles.marketCell}>{marketValue(i)}</td><td data-label="Expected profit" className={i.expected_profit_cents !== null && i.expected_profit_cents < 0 ? styles.loss : styles.profit}>{money(i.expected_profit_cents)}<small>{i.expected_margin_pct === null ? 'Price or cost not set' : `${i.expected_margin_pct.toFixed(1)}% margin`}</small></td><td><button className={styles.iconButton} aria-label={`Open ${i.name || 'inventory'}`} onClick={() => openItem(i)}><Icon name="chevron" /></button></td></tr>)}</tbody></table></div>}
      </section> : <StaffInventoryLocationBrowser locations={data?.locations ?? []} items={data?.items ?? []} token={token} pointCache={pointCache.current} onViewInventory={id => { setLocation(id); setCategory(''); setQuery(''); setSalesChannel(''); setTab('inventory'); }} />}
      <footer className={styles.footer}><button className={styles.mobileAdvanced} onClick={onAdvanced}>Advanced records</button><span>Staff records are saved securely in Ten Kings.</span><span>{data?.updated_at ? `Latest activity ${new Date(data.updated_at).toLocaleString()}` : 'Ready for your first entry'}</span></footer>
    </main>
    {(mode || item) && <div className={styles.overlay} onMouseDown={e => { if (e.target === e.currentTarget) close(); }}><div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="inventory-dialog-title" className={styles.drawer}>
      <div className={styles.drawerHeader} hidden={captureVisible}><div><span className={styles.eyebrow}>{mode === 'add' ? 'BUILD YOUR INVENTORY' : 'INVENTORY DETAILS'}</span><h2 id="inventory-dialog-title">{mode === 'add' ? 'Add inventory' : mode === 'edit' ? 'Edit selected cards' : mode === 'move' ? 'Move inventory' : mode === 'prepare' ? 'Update condition' : mode === 'cost' ? 'Update purchase cost' : mode === 'count' ? 'Record machine count' : mode === 'location' ? 'Add location' : item?.name || 'Inventory details'}</h2></div><button className={styles.iconButton} aria-label="Close inventory details" disabled={busy || !!pending} onClick={close}><Icon name="close" /></button></div>
      {(mode === 'add' && draft.type === 'single' || mode === 'edit' && selected.length === 1) && <StaffInventoryCardCapture autoStartCamera={autoStartCamera} open={captureOpen} cycle={captureCycle} initialSource={captureSource} disabled={busy || !!pending} onSideReady={(side, file) => { setPhotoStatus(`Saving ${side} photo…`); void uploadSide(side, file); }} onPricingStart={mode === 'add' ? beginPricing : undefined} onPricingCancel={() => setCapturePricing(false)} onPair={(front, back) => void pairCaptured(front, back)} onClose={() => cancelPhoto()} onError={message => setPhotoStatus(message)} locationStatus={mode === 'add' ? locationStatus : undefined} />}
      {!captureVisible && <>{!mode && error && <div role="alert" className={styles.error}>{error}</div>}{!mode && retryControls}{mode === 'add' && notice && <div className={styles.intakeNotice} role="status">{notice}</div>}</>}
      {mode ? <FieldErrors.Provider value={fieldErrors}><form ref={form} noValidate hidden={captureVisible} onSubmit={e => { e.preventDefault(); if (guidedPricing && pricingStep !== 'channel') advancePricing(); else void save(); }}><fieldset disabled={busy || !!pending} className={styles.formBody}>
        {mode === 'location' && <section className={styles.formSection}><Field label="Location name"><input required value={draft.name} onChange={e => change('name', e.target.value)} /></Field><Field label="Street address"><input required value={draft.address} onChange={e => change('address', e.target.value)} /></Field><Field label="Location type"><select required value={draft.kind} onChange={e => change('kind', e.target.value)}><option value="">Choose a type</option><option value="hq">HQ / storage</option><option value="store">Store</option><option value="kiosk">Kiosk</option></select></Field><p className={styles.helper}>HQ and storage locations are private to your team. Use an existing venue location when assigning stock to a vending machine.</p></section>}
        {mode === 'add' && <><div className={styles.segment} aria-label="Inventory type">{[['single', 'Individual card'], ['batch', 'Batch of cards']].map(([key, name]) => <button type="button" key={key} aria-pressed={draft.type === key} disabled={uploading} onClick={() => { cancelPhoto(); setPricingStep(null); change('type', key); }}>{name}</button>)}</div><p className={styles.helper}>Add cards you own and have on hand. {draft.type === 'single' ? 'Save a card, then go straight to the next one.' : 'Enter one batch and its total cost.'}</p></>}

        {(mode === 'add' || mode === 'edit') && <section className={styles.formSection}><h3>{mode === 'add' ? '1. What are you adding?' : `${selected.length} selected ${selected.length === 1 ? 'card' : 'cards'}`}</h3>{descriptionFields}{mode === 'add' && draft.type === 'batch' && <Field label="Number of cards"><input required type="number" inputMode="numeric" min="1" max="2000" step="1" value={draft.quantity} onChange={e => change('quantity', e.target.value)} /></Field>}</section>}
        {(mode === 'add' || mode === 'move') && <section className={styles.formSection}><h3>{mode === 'add' ? '2. Where is it?' : `Move ${selected.length} selected ${selected.length === 1 ? 'card' : 'cards'}`}</h3><div className={styles.formGrid}>{locationFields}</div>{mode === 'move' && <label className={styles.checkbox}><input type="checkbox" checked={draft.planned} onChange={e => change('planned', e.target.checked)} /><span>Plan this move for later<small>Leave unchecked if the cards have already arrived.</small></span></label>}{mode === 'add' && <div className={styles.locationAssist}><p role="status">{locationStatus || (draft.location ? 'Using this location for your next cards.' : 'Take photos to find your location, or choose it above.')}</p><button type="button" onClick={() => void locateInventory(true)} disabled={busy || !!pending}><Icon name="pin" size={15} />Use my location</button></div>}</section>}
        {(mode === 'add' || mode === 'edit' || mode === 'cost') && <section className={styles.formSection}>
          <h3>{mode === 'add' ? '3. Cost & sales channel' : mode === 'cost' ? 'Purchase cost' : 'Expected price & sales channel'}</h3>
          {guidedPricing && <ol className={styles.pricingSteps} aria-label="Inventory entry progress"><li aria-current={pricingStep === 'cost' ? 'step' : undefined}>1. Cost</li><li aria-current={pricingStep === 'channel' ? 'step' : undefined}>2. Sales channel</li></ol>}
          <div className={styles.formGrid}>
            {mode !== 'edit' && <Field label={draft.type === 'single' ? 'Card acquisition cost' : 'Total batch acquisition cost'} help={draft.type === 'single' ? 'What you paid. Leave blank if unknown.' : mode === 'cost' && draft.costSplit === 'custom' ? 'The total paid for every card in the original purchase.' : `This total is divided equally across ${mode === 'cost' ? item?.receipt_quantity : draft.quantity || 'the'} cards. Leave blank if unknown.`}><div className={styles.currencyInput}><span>$</span><input ref={costInput} inputMode="decimal" enterKeyHint={guidedPricing ? 'next' : undefined} value={draft.cost} onChange={e => change('cost', e.target.value)} /></div></Field>}
            {mode === 'edit' && <div><Field label="Expected sale price per card" help="Your planned price. Leave blank if not decided."><div className={styles.currencyInput}><span>$</span><input inputMode="decimal" value={draft.price} onChange={e => change('price', e.target.value)} /></div></Field></div>}
          </div>
          {mode !== 'cost' && (guidedPricing ? <fieldset ref={channelChoices} className={styles.channelChoices} hidden={pricingStep !== 'channel'}><legend>Sales channel</legend><p>Where you plan to sell this card. You can change this later.</p><div>{['', ...channelOptions].map(channel => <label key={channel} className={styles.channelChoice}><input type="radio" name="inventory-sales-channel" value={channel} checked={draft.salesChannel === channel} onChange={() => { change('salesChannel', channel); }} /><span>{channel || 'Not decided yet'}</span></label>)}</div></fieldset> : <Field label="Sales channel" help={draft.type === 'batch' && mode === 'add' || mode === 'edit' && selected.length > 1 ? 'Where you plan to sell these cards. You can change this later.' : 'Where you plan to sell this card. You can change this later.'}><select value={draft.salesChannel} onChange={e => change('salesChannel', e.target.value)}><option value="">Not decided yet</option>{channelOptions.map(c => <option key={c}>{c}</option>)}</select></Field>)}
          {mode === 'cost' && item && item.receipt_quantity > 1 && <><Field label="How should the batch cost be split?"><select value={draft.costSplit} onChange={e => change('costSplit', e.target.value)}><option value="equal">Split evenly across every card</option><option value="custom">Enter a different cost for each card</option></select></Field>{draft.costSplit === 'custom' && <div className={styles.cardCosts}>{(data?.items.filter(i => i.lot_id === item.lot_id) ?? []).flatMap(i => i.units.map(u => <Field key={u.id} label={`Card ${u.number} · ${i.name || 'Unnamed card'}`}><div className={styles.currencyInput}><span>$</span><input inputMode="decimal" value={draft.cardCosts[u.id] ?? ''} onChange={e => change('cardCosts', { ...draft.cardCosts, [u.id]: e.target.value })} /></div></Field>))}<p className={styles.helper}>All card costs must add up to the total batch cost above.</p></div>}</>}
          {mode === 'cost' && <p className={styles.helper}>This updates the acquisition cost of the entire original purchase ({item?.receipt_quantity} cards), including cards moved to other locations. The original entry stays in history.</p>}
        </section>}
        {mode === 'count' && <section className={styles.formSection}><Field label="Cards physically counted" help="Count this product across the selected machine scope, including all loading batches."><input required type="number" min="0" step="1" inputMode="numeric" value={draft.quantity} onChange={e => change('quantity', e.target.value)} /></Field><p className={styles.helper}>{item?.location_name} · machine {item?.machine_scope?.machine_id} · product {item?.machine_scope?.product_id}{item?.machine_scope?.door_id ? ` · slot ${item.machine_scope.door_id}` : ' · all slots'}</p><p className={styles.helper}>This records what staff counted at the time below. It does not guess which individual cards sold.</p></section>}
        {mode === 'prepare' && <section className={styles.formSection}><Field label="New condition"><select required value={draft.stage} onChange={e => change('stage', e.target.value)}><option value="">Choose completed work</option><option value="processing">Being prepared</option><option value="processed">Ready to pack</option><option value="packed">Packed — one card per pack</option></select></Field><Field label="Product"><select value={draft.product} onChange={e => change('product', e.target.value)}><option value="">{item?.name || 'This inventory'}</option>{data?.products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><p className={styles.helper}>Record work that has actually been completed. Packing keeps each card’s purchase cost attached.</p></section>}
        {mode === 'add' ? <details className={styles.entryDetails}><summary>More details <span>Receipt, date and notes</span></summary><div className={styles.formSection}><label className={styles.checkbox}><input type="checkbox" checked={draft.origin === 'purchase'} onChange={e => change('origin', e.target.checked ? 'purchase' : 'existing')} /><span>This is a newly received purchase<small>Optional receipt history. Both choices add inventory you currently own; neither records a bank payment or sale.</small></span></label><Field label="Entry date and time"><input required type="datetime-local" value={draft.date} max={localNow()} onChange={e => change('date', e.target.value)} /></Field><Field label="Notes or receipt reference (optional)"><textarea rows={3} maxLength={1600} value={draft.note} onChange={e => change('note', e.target.value)} /></Field></div></details> : mode !== 'location' && <section className={styles.formSection}><Field label="Date and time"><input required type="datetime-local" value={draft.date} max={localNow()} onChange={e => change('date', e.target.value)} /></Field><Field label={mode === 'cost' ? 'Receipt reference / reason' : 'Notes or receipt reference (optional)'}><textarea rows={3} maxLength={1600} value={draft.note} onChange={e => change('note', e.target.value)} /></Field></section>}
      </fieldset><div className={styles.drawerFooter}>{error && <p className={styles.saveError} role="alert">{error}</p>}{!busy && retryControls}{(busy || uploading || photoError) && <p className={styles.footerPhotoStatus} role="status">{busy ? 'Saving your entry…' : uploading ? photoStatus : 'Retry the photo or choose how to continue above.'}</p>}<div className={styles.saveActions} hidden={!!pending && !busy}><button type="button" className={styles.secondary} disabled={busy || !!pending} onClick={close}>Cancel</button>{guidedPricing && pricingStep !== 'channel' ? <button key="pricing-next" type="button" className={styles.primary} disabled={busy || !!pending} aria-label="Next: sales channel" onClick={event => { event.preventDefault(); advancePricing(); }}>Next<Icon name="arrow" size={18} /></button> : <button key="inventory-save" type="submit" className={styles.primary} disabled={busy || uploading || !!photoError || !!pending}>{busy ? 'Saving…' : uploading ? 'Preparing photo…' : mode === 'add' ? 'Add inventory' : mode === 'location' ? 'Add location' : mode === 'move' ? draft.planned ? 'Save planned move' : 'Save move' : 'Save changes'}<Icon name="arrow" size={18} /></button>}</div></div></form></FieldErrors.Provider> : item && <div className={styles.itemDetail}>
        <div className={styles.detailHero}>{item.photo_url ? <img src={item.photo_url} alt={item.name || 'Inventory'} /> : <Icon name="cards" size={65} />}<span>{item.category || 'Category not set'}</span></div>
        {item.back_photo_url && <div className={styles.detailBack}><img src={item.back_photo_url} alt="Back of inventory card" /><span>Back</span></div>}
        {item.card_details && <dl className={styles.savedCardMetadata}>{cardFields.filter(field => item.card_details?.[field]).map(field => <div key={field}><dt>{cardFieldLabels[field]}</dt><dd>{item.card_details?.[field]}</dd></div>)}</dl>}
        <div className={styles.detailFacts}><div><span>Location</span><strong>{item.location_name || 'Not named'}</strong></div><div><span>Condition</span><strong>{stageNames[item.stage]}</strong></div><div><span>{item.quantity_kind === 'loaded_roster' ? 'Loaded roster' : 'On hand'}</span><strong>{item.quantity} cards</strong></div><div><span>Acquisition cost</span><strong>{money(item.cost_cents)}</strong></div><div><span>Expected sale / card</span><strong>{money(item.expected_price_cents)}</strong></div><div><span>Expected gross profit</span><strong className={styles.profit}>{money(item.expected_profit_cents)}</strong></div><div><span>Sales channel</span><strong>{item.planned_sales_channel || 'Not decided yet'}</strong></div></div>
        {reviewBinding && <div ref={researchSection} tabIndex={-1} role="region" aria-label="Card research" className={styles.researchSection}><StaffInventoryResearchPanel key={marketKey(reviewBinding)} unitId={reviewBinding[0]} token={token} descriptionEventId={reviewBinding[1]} actorId={adminId} inventoryPhotos={{ front: reviewItem?.photo_url ?? null, back: reviewItem?.back_photo_url ?? null }} /></div>}
        {item.quantity_kind === 'loaded_roster' && <p className={styles.helper}>This is a machine’s loading record. A physical count is needed to establish what remains; individual sold cards are not identified by aggregate sales.</p>}
        {item.last_count && <p className={styles.helper}>Last physical count for this machine product: <strong>{item.last_count.quantity} cards</strong> on {new Date(item.last_count.at).toLocaleString()}.</p>}
        <div className={styles.detailActions}>{item.machine_scope && <button className={styles.primary} disabled={!!pending} onClick={() => edit('count')}>Record machine count</button>}<button className={styles.primary} disabled={!selected.length || !!pending} onClick={() => edit('edit')}>Edit details & price</button><button className={styles.secondary} disabled={!selected.length || !!pending || item.quantity_kind === 'loaded_roster'} onClick={() => edit('move')}><Icon name="pin" size={18} />Move / assign</button><button className={styles.secondary} disabled={!selected.length || !!pending || item.quantity_kind === 'loaded_roster'} onClick={() => edit('prepare')}>Update condition</button><button className={styles.secondary} disabled={!!pending} onClick={() => edit('cost')}>Edit purchase cost</button></div>
        <div className={styles.rosterTitle}><h3>Cards in this group</h3><span>{selected.length} selected</span><button onClick={() => setSelected(selected.length === item.unit_ids.length ? [] : item.unit_ids)}>{selected.length === item.unit_ids.length ? 'Deselect all' : 'Select all'}</button></div><p className={styles.helper}>Select one card to give it its own name, photo, price or sales channel. Select several to move or update them together.</p>
        <div className={styles.roster}>{item.units.map(u => <label key={u.id}><input type="checkbox" checked={selected.includes(u.id)} onChange={e => setSelected(s => e.target.checked ? [...s, u.id] : s.filter(id => id !== u.id))} /><span>Card {u.number}<small>{u.planned_location_name ? `Planned: ${u.planned_location_name}` : u.permanent_card_id ? 'Linked graded card' : stageNames[item.stage]}</small></span><strong>{money(u.cost_cents)}<small>acquisition cost</small></strong></label>)}</div>
        {item.notes && <p className={styles.detailNotes}>{item.notes}</p>}<details className={styles.history}><summary>Record details</summary><p>Added {new Date(item.created_at).toLocaleString()} · {item.origin === 'existing' ? 'Current stock' : 'New purchase'}</p><p>Source references</p>{Object.entries(item.provenance).map(([k, v]) => v && <p key={k}>{k}: {v}</p>)}<button className={styles.secondary} onClick={onAdvanced}>Open advanced records</button></details>
      </div>}
    </div></div>}
  </div>;
}
