import { useEffect, useState } from 'react';
import { request as defaultRequest } from '../../lib/client.mjs';
import styles from './commerce.module.css';
import CustomerHandoff from '../dealer/CustomerHandoff.jsx';
import ShippingCheckout from './ShippingCheckout.jsx';

const money = value => Number.isInteger(value) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value / 100) : 'Unavailable';
const scheduleTime = (value, zone) => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: zone ?? 'UTC', timeZoneName: 'short' }).format(new Date(value)) : 'Not yet scheduled';

export function ServiceSummary({ snapshot, saved = false }) {
    const kiosk = snapshot.channel === 'KIOSK', location = snapshot.location, terms = snapshot.terms ?? {};
    const separateShipping = !kiosk && terms.shippingPayment === 'SEPARATE_PAYMENT';
    const unitCents = snapshot.cards?.[0]?.unitCents ?? snapshot.unitCents;
    const duration = terms.days === 7 ? 'One week' : terms.days === 14 ? 'Two weeks' : Number.isInteger(terms.days) && terms.days > 0 ? `${terms.days} days` : null;
    const start = { ATLAS_COLLECTION: 'actual ATLAS collection', ATLAS_RECEIPT: 'physical receipt at ATLAS', CARRIER_ACCEPTANCE: 'carrier acceptance' }[terms.clockStart];
    return <>
        <div className={styles.service}><strong>{kiosk ? 'Card-shop grading' : 'Mail-in grading'}{Number.isInteger(unitCents) ? ` · ${money(unitCents)} per card` : ''}</strong>
            <p>{duration && start ? `${duration} from ${start}.` : saved ? 'Saved turnaround terms are unavailable.' : kiosk ? 'One week from actual ATLAS collection.' : 'Two-week service. The start date is confirmed with your exact quote.'} {kiosk && 'Pickup and return included.'}</p>
            {separateShipping && <p>{saved ? 'Your grading payment is confirmed. Shipping is quoted and paid separately.' : 'Pay for grading now. Choose your shipping service and approve a separate shipping payment later.'} Keep your cards until your shipping label is ready.</p>}
            {!kiosk && !separateShipping && terms.mailChargedLegs === 'BOTH_LEGS' && <p>{saved?'Shipping paid for the trip to ATLAS and the return trip.':'Shipping includes the trip to ATLAS and the return trip.'} ATLAS handles return shipping after grading.</p>}
            {!kiosk && !separateShipping && terms.mailChargedLegs === 'INBOUND_ONLY' && <p>{saved?'Shipping paid for the trip to ATLAS only.':'Shipping includes the trip to ATLAS only.'} Return shipping is not included in this payment.</p>}
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
    const separateShipping = snapshot.channel === 'MAIL_IN' && snapshot.terms?.shippingPayment === 'SEPARATE_PAYMENT' && snapshot.purpose !== 'SHIPPING';
    return <><ShippingSummary snapshot={snapshot}/><dl className={styles.amounts}><div><dt>Grading · {count} {count === 1 ? 'card' : 'cards'}</dt><dd>{money(snapshot.subtotalCents)}</dd></div>
        <div><dt>{snapshot.channel === 'KIOSK' ? 'Pickup and return' : 'Shipping'}</dt><dd>{separateShipping ? 'Quoted and paid separately' : snapshot.channel === 'KIOSK' && snapshot.shippingCents === 0 ? 'Included' : money(snapshot.shippingCents)}</dd></div>
        <div><dt>{separateShipping ? 'Tax on grading' : 'Tax'}</dt><dd>{money(snapshot.taxCents)}</dd></div><div className={styles.total}><dt>{separateShipping ? paid ? 'Grading paid' : 'Due now' : paid ? 'Paid' : 'Total'}</dt><dd>{money(snapshot.totalCents)}</dd></div></dl></>;
}

export function ShippingSummary({ snapshot }) {
    if(snapshot.channel!=='MAIL_IN'||!snapshot.shipping?.length)return null;
    const parcel=snapshot.inboundPackage;
    return <div className={styles.shippingSummary} aria-label="Selected shipping"><h3>Selected shipping</h3>{parcel&&<p className={styles.note}>Your package to ATLAS: {parcel.weight.value} {({ounce:'oz',pound:'lb',gram:'g',kilogram:'kg'})[parcel.weight.unit]} · {parcel.dimensions.length} × {parcel.dimensions.width} × {parcel.dimensions.height} {parcel.dimensions.unit==='inch'?'in':'cm'}</p>}<dl>{snapshot.shipping.map((leg,index)=><div key={`${leg.leg}:${index}`}><dt>{({INBOUND:'Your cards → ATLAS',RETURN:'ATLAS → your address'})[leg.leg]??'Shipping'}<small>{[leg.carrierName,leg.serviceName].filter(Boolean).join(' · ') || 'Saved shipping service'}</small></dt><dd>{money(leg.amountCents)}</dd></div>)}</dl></div>;
}

const shippingProvider = effect => ({FEDEX_LABEL:'fedex',SHIPSTATION_LABEL:'shipstation'})[effect.kind];

export function deliveryLabel(effect) {
    if (effect.state === 'UNKNOWN') return 'Checking status';
    if (effect.state === 'FAILED') return 'Needs attention';
    if (effect.state !== 'SUCCEEDED') return 'Preparing';
    return ({ DELIVERED: 'Delivered', SENT: 'Sent', ACCEPTED: 'Accepted for delivery', QUEUED: 'Queued for delivery', FAILED: 'Delivery failed', UNDELIVERED: 'Not delivered' })[effect.deliveryStatus] ?? 'Delivery not confirmed';
}

export function shippingLabelLeg(effect, orderId) {
    // The persisted effect identity binds the shipment leg to this paid order.
    // Do not guess a direction for an unfamiliar legacy/provider identifier.
    const provider=shippingProvider(effect);
    if (!provider || !orderId) return null;
    for (const leg of ['INBOUND', 'RETURN']) {
        if (effect.id === `${orderId}:${provider}:${leg}:v1` && (!effect.leg||effect.leg===leg)) return leg;
    }
    return null;
}

export function ShippingLabelStatus({ order }) {
    if (order.receipt?.channel !== 'MAIL_IN') return null;
    const labels = (order.effects ?? []).filter(effect => shippingLabelLeg(effect, order.id) === 'INBOUND');
    if (labels.length !== 1 && !(labels.length === 0 && order.shippingPayment)) return null;
    const label = labels[0] ?? { state:'PENDING' };
    const notify = order.shippingPayment?.labelReadyEmailEnabled === true;
    const message = {
        PENDING: notify ? 'Your shipping label is pending. We’ll email you when it’s ready to print.' : 'Your shipping label is pending. Refresh your receipt to check its status.',
        DISPATCHED: 'Your shipping label is being prepared. Refresh your receipt to check its status.',
        UNKNOWN: 'We’re checking your shipping label status. Refresh your receipt for the latest update.',
        FAILED: 'Your shipping label needs attention. Contact ATLAS support before mailing your cards.',
        SUCCEEDED: 'Your shipping label is ready to print. Download the label to ATLAS below.',
    }[label.state] ?? 'Your shipping label status is unavailable. Refresh your receipt for the latest update.';
    return <div className={styles.service} role="status" aria-label="Shipping label"><strong>Shipping label</strong><p>{message}</p>
        {label.state !== 'SUCCEEDED' && <p>Keep your cards until your label and mailing instructions are ready.</p>}</div>;
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
            if (shippingProvider(effect) && shippingLabelLeg(effect, order.id) !== 'INBOUND') throw Error('LABEL_DIRECTION_UNAVAILABLE');
            const label = await request(`/commerce/orders/${order.id}/labels/${encodeURIComponent(effect.id)}`);
            if (label.mimeType !== 'application/pdf' || typeof label.labelBase64 !== 'string') throw Error('LABEL_NOT_READY');
            const bytes = Uint8Array.from(atob(label.labelBase64), c => c.charCodeAt(0));
            if (bytes.length > 4 * 1024 * 1024 || new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') throw Error('LABEL_NOT_READY');
            const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
            if (hash !== label.labelSha256) throw Error('LABEL_NOT_READY');
            const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })), anchor = document.createElement('a');
            anchor.href = url; anchor.download = `${order.reference}-${shippingProvider(effect) ? 'ship-to-ATLAS' : 'package'}.pdf`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        });
    }
    const kiosk = order?.receipt?.channel === 'KIOSK';
    return <section className={styles.panel} aria-label="Order receipt">
        {order ? <><p className={styles.eyebrow}>PAYMENT CONFIRMED</p><h2>Your cards have a place.</h2>
            <p className={styles.reference}>{order.reference}</p><p>Your digital receipt is saved here. Receipt delivery updates appear below.</p>
            <ServiceSummary snapshot={order.receipt} saved/><OrderAmounts snapshot={order.receipt} paid/>
            {kiosk && <CustomerHandoff orderId={order.id} request={request}/>}
            {!kiosk && <ShippingLabelStatus order={order}/>}
            {!kiosk && order.receipt.terms?.shippingPayment === 'SEPARATE_PAYMENT' && <ShippingCheckout order={order} request={request} onOrder={setOrder}/>}
            <h3>{kiosk ? 'Ready for your shop handoff' : 'Prepare your shipment'}</h3>
            <p>Protect each card in a sleeve and card holder. Keep the cards together in a secure package and include your order number.</p>
            <p>{kiosk ? 'Show your handoff code to staff at your selected card shop. They will check every card and confirm receipt. ATLAS collection is recorded separately.' : (order.shippingPayment?.receipt?.shipping?.length || order.receipt.shipping?.length) ? 'Use the package size and carrier saved with your shipping payment. Print and attach the saved label when it is ready.' : 'Your mailing instructions will appear with your shipping label. Keep your cards until those details are ready.'}</p>
            <ul className={styles.deliveries}>{(order.effects ?? []).filter(effect => ['EMAIL_RECEIPT', 'EMAIL_SHIPPING_RECEIPT', 'EMAIL_LABEL_READY', 'SMS_RECEIPT', 'FEDEX_LABEL', 'SHIPSTATION_LABEL', 'PACKAGE_LABEL'].includes(effect.kind)).map(effect => {
                const leg = shippingLabelLeg(effect, order.id), carrier = Boolean(shippingProvider(effect));
                const label = carrier ? leg === 'INBOUND' ? 'Ship your cards to ATLAS' : leg === 'RETURN' ? 'Return shipping from ATLAS' : 'Shipping label · direction unavailable'
                    : { EMAIL_RECEIPT: 'Grading receipt email', EMAIL_SHIPPING_RECEIPT: 'Shipping receipt email', EMAIL_LABEL_READY: 'Shipping label email', SMS_RECEIPT: 'Text receipt', PACKAGE_LABEL: 'Package label' }[effect.kind];
                return <li key={effect.id}><span>{label}{carrier&&effect.carrierName&&<small className={styles.carrierName}>{[effect.carrierName,effect.serviceName].filter(Boolean).join(' · ')}</small>}</span>
                    {effect.state === 'SUCCEEDED' && (effect.kind === 'PACKAGE_LABEL' || leg === 'INBOUND')
                        ? <button className={styles.secondary} disabled={busy} onClick={() => downloadLabel(effect)}>{carrier ? 'Download label to ATLAS' : 'Download label'}</button>
                        : <span>{carrier && effect.state === 'SUCCEEDED' ? leg === 'RETURN' ? 'ATLAS uses this label after grading' : 'Contact support for this label' : carrier && leg==='RETURN' && effect.state==='PENDING' ? 'ATLAS prepares this after grading' : deliveryLabel(effect)}</span>}</li>;
            })}</ul>
            <p className={styles.note}>Payment does not confirm physical drop-off, mailing or arrival at ATLAS. Downloading a label does not confirm it has been printed.</p></> : !error && <p role="status">Loading your saved receipt…</p>}
        <button className={styles.secondary} disabled={busy} onClick={() => work(async () => setOrder(await request(`/commerce/orders/${orderId}`)))}>Refresh receipt and labels</button>
        {error && <p className={styles.error} role="alert">{error}</p>}
    </section>;
}
