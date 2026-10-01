import { useEffect, useState } from 'react';
import { request as defaultRequest } from '../../lib/client.mjs';
import styles from './commerce.module.css';
import CustomerHandoff from '../dealer/CustomerHandoff.jsx';

const money = value => Number.isInteger(value) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value / 100) : 'Unavailable';
const scheduleTime = (value, zone) => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: zone ?? 'UTC', timeZoneName: 'short' }).format(new Date(value)) : 'Not yet scheduled';

export function ServiceSummary({ snapshot, saved = false }) {
    const kiosk = snapshot.channel === 'KIOSK', location = snapshot.location, terms = snapshot.terms ?? {};
    const unitCents = snapshot.cards?.[0]?.unitCents ?? snapshot.unitCents;
    const duration = terms.days === 7 ? 'One week' : terms.days === 14 ? 'Two weeks' : Number.isInteger(terms.days) && terms.days > 0 ? `${terms.days} days` : null;
    const start = { ATLAS_COLLECTION: 'actual ATLAS collection', ATLAS_RECEIPT: 'physical receipt at ATLAS', CARRIER_ACCEPTANCE: 'carrier acceptance' }[terms.clockStart];
    return <>
        <div className={styles.service}><strong>{kiosk ? 'Card-shop grading' : 'Mail-in grading'}{Number.isInteger(unitCents) ? ` · ${money(unitCents)} per card` : ''}</strong>
            <p>{duration && start ? `${duration} from ${start}.` : saved ? 'Saved turnaround terms are unavailable.' : kiosk ? 'One week from actual ATLAS collection.' : 'Two-week service. The start date is confirmed with your exact quote.'} {kiosk && 'Pickup and return included.'}</p>
            {!kiosk && terms.mailChargedLegs === 'BOTH_LEGS' && <p>Shipping paid for the trip to ATLAS and the return trip.</p>}
            {!kiosk && terms.mailChargedLegs === 'INBOUND_ONLY' && <p>Shipping paid for the trip to ATLAS only. Return shipping is not included in this payment.</p>}
        </div>
        {location && <div className={styles.route}><strong>{location.name}</strong>
            <p>{Object.values(location.address ?? {}).filter(Boolean).join(', ')}</p>
            <p>{saved ? 'Collection shown at checkout' : 'Next collection'}: {scheduleTime(location.schedule?.nextCollectionAt, location.schedule?.timeZone)}</p>
            <p>{saved ? 'Return projected at checkout' : 'Projected return'}: {scheduleTime(location.schedule?.projectedReturnAt, location.schedule?.timeZone)}</p>
            {location.schedule?.cutoffAt && <p>Drop-off cutoff: {scheduleTime(location.schedule.cutoffAt, location.schedule.timeZone)}</p>}
            {location.schedule?.exceptions?.map((exception, index) => <p key={`${exception.date}-${exception.kind}-${index}`}>{exception.date}: {exception.kind === 'pickups' ? 'Collection' : 'Return'} {exception.cancelled ? 'canceled' : exception.time}.{exception.cutoff && !exception.cancelled && ` Cutoff ${exception.cutoff}.`}{exception.reason && ` ${exception.reason}`}</p>)}
            <small>{saved ? 'These are the dates saved with your payment. See recorded progress below for current updates.' : 'Scheduled dates are estimates. Actual collection is recorded separately.'}</small>
        </div>}
    </>;
}

export function OrderAmounts({ snapshot, paid = false }) {
    const count = snapshot.cards?.length ?? 0;
    return <dl className={styles.amounts}><div><dt>Grading · {count} {count === 1 ? 'card' : 'cards'}</dt><dd>{money(snapshot.subtotalCents)}</dd></div>
        <div><dt>{snapshot.channel === 'KIOSK' ? 'Pickup and return' : 'FedEx shipping'}</dt><dd>{snapshot.channel === 'KIOSK' && snapshot.shippingCents === 0 ? 'Included' : money(snapshot.shippingCents)}</dd></div>
        <div><dt>Tax</dt><dd>{money(snapshot.taxCents)}</dd></div><div className={styles.total}><dt>{paid ? 'Paid' : 'Total'}</dt><dd>{money(snapshot.totalCents)}</dd></div></dl>;
}

export function deliveryLabel(effect) {
    if (effect.state === 'UNKNOWN') return 'Checking status';
    if (effect.state === 'FAILED') return 'Needs attention';
    if (effect.state !== 'SUCCEEDED') return 'Preparing';
    return ({ DELIVERED: 'Delivered', SENT: 'Sent', ACCEPTED: 'Accepted for delivery', QUEUED: 'Queued for delivery', FAILED: 'Delivery failed', UNDELIVERED: 'Not delivered' })[effect.deliveryStatus] ?? 'Delivery not confirmed';
}

export default function OrderReceipt({ initialOrder = null, orderId = initialOrder?.id, request = defaultRequest }) {
    const [order, setOrder] = useState(initialOrder), [busy, setBusy] = useState(false), [error, setError] = useState('');
    useEffect(() => {
        if (initialOrder) { setOrder(initialOrder); return; }
        let current = true;
        setOrder(null); setError('');
        request(`/commerce/orders/${orderId}`).then(value => { if (current) setOrder(value); }).catch(() => { if (current) setError('Your saved receipt is unavailable right now. Refresh to try again.'); });
        return () => { current = false; };
    }, [initialOrder, orderId, request]);
    async function work(operation) {
        if (busy) return;
        setBusy(true); setError('');
        try { await operation(); } catch { setError('Your saved receipt or label could not be loaded. Refresh to try again.'); } finally { setBusy(false); }
    }
    async function downloadLabel(effect) {
        await work(async () => {
            const label = await request(`/commerce/orders/${order.id}/labels/${encodeURIComponent(effect.id)}`);
            if (label.mimeType !== 'application/pdf' || typeof label.labelBase64 !== 'string') throw Error('LABEL_NOT_READY');
            const bytes = Uint8Array.from(atob(label.labelBase64), c => c.charCodeAt(0));
            if (bytes.length > 4 * 1024 * 1024 || new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') throw Error('LABEL_NOT_READY');
            const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
            if (hash !== label.labelSha256) throw Error('LABEL_NOT_READY');
            const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })), anchor = document.createElement('a');
            anchor.href = url; anchor.download = `${order.reference}-${effect.kind === 'FEDEX_LABEL' ? 'FedEx' : 'package'}.pdf`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        });
    }
    const kiosk = order?.receipt?.channel === 'KIOSK';
    return <section className={styles.panel} aria-label="Order receipt">
        {order ? <><p className={styles.eyebrow}>PAYMENT CONFIRMED</p><h2>Your cards have a place.</h2>
            <p className={styles.reference}>{order.reference}</p><p>Your digital receipt is saved here. Receipt delivery updates appear below.</p>
            <ServiceSummary snapshot={order.receipt} saved/><OrderAmounts snapshot={order.receipt} paid/>
            {kiosk && <CustomerHandoff orderId={order.id} request={request}/>}
            <h3>{kiosk ? 'Ready for your shop handoff' : 'Prepare your shipment'}</h3>
            <p>Protect each card in a sleeve and card holder. Keep the cards together in a secure package and include your order number.</p>
            <p>{kiosk ? 'Show your handoff code to staff at your selected card shop. They will check every card and confirm receipt. ATLAS collection is recorded separately.' : 'Your FedEx label is prepared after payment. Use the package size selected at checkout. Print and attach the saved label when it is ready.'}</p>
            <ul className={styles.deliveries}>{(order.effects ?? []).filter(effect => ['EMAIL_RECEIPT', 'SMS_RECEIPT', 'FEDEX_LABEL', 'PACKAGE_LABEL'].includes(effect.kind)).map(effect => <li key={effect.id}><span>{{ EMAIL_RECEIPT: 'Email receipt', SMS_RECEIPT: 'Text receipt', FEDEX_LABEL: 'FedEx label', PACKAGE_LABEL: 'Package label' }[effect.kind]}</span>
                {effect.state === 'SUCCEEDED' && ['FEDEX_LABEL', 'PACKAGE_LABEL'].includes(effect.kind) ? <button className={styles.secondary} disabled={busy} onClick={() => downloadLabel(effect)}>Download label</button> : <span>{deliveryLabel(effect)}</span>}</li>)}</ul>
            <p className={styles.note}>Payment does not confirm physical drop-off, mailing or arrival at ATLAS. Downloading a label does not confirm it has been printed.</p></> : !error && <p role="status">Loading your saved receipt…</p>}
        <button className={styles.secondary} disabled={busy} onClick={() => work(async () => setOrder(await request(`/commerce/orders/${orderId}`)))}>Refresh receipt and labels</button>
        {error && <p className={styles.error} role="alert">{error}</p>}
    </section>;
}
