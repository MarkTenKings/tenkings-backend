import { useCallback, useEffect, useRef, useState } from 'react';
import PaymentFields from './PaymentFields.jsx';
import styles from './commerce.module.css';

const money = value => Number.isInteger(value) ? new Intl.NumberFormat('en-US', { style:'currency', currency:'USD' }).format(value / 100) : 'Unavailable';
const message = error => ({
    SHIPPING_NOT_CONFIGURED:'Carrier quotes are not available yet. Your grading payment and cards are saved.',
    MEASURED_PACKAGING_NOT_CONFIGURED:'Shipping options for this submission are being prepared. Your grading payment and cards are saved.',
    SHIPSTATION_RATE_UNAVAILABLE:'That service could not be quoted. Choose another available service or try again later.',
    SHIPSTATION_REQUEST_FAILED:'Carrier quotes are unavailable right now. Your grading payment and cards are saved.',
    SHIPPING_QUOTE_INVALID:'The shipping quote could not be confirmed. Request a fresh total.',
    SHIPPING_QUOTE_EXPIRED:'This shipping quote expired. Request a fresh total.',
    CHECKOUT_CHANGED:'Shipping details changed. Request a fresh total before paying.',
    PACKAGE_EXCEEDS_PARCEL_LIMITS:'That package exceeds the supported parcel size or weight. Check your measurements.',
    MEASURED_PACKAGE_REQUIRED:'Enter the actual weight and outside dimensions of your packed shipment.',
    PAYMENT_RECONCILIATION_REQUIRED:'We are checking your original shipping payment. Do not pay again.',
    SHIPPING_TAX_NOT_CONFIGURED:'Shipping tax calculation is not available yet. Your grading payment is saved.',
    PAYMENT_NOT_CONFIGURED:'Shipping payment is not available yet. Your grading payment is saved.',
    MAIL_SHIPPING_TERMS_NOT_CONFIGURED:'Shipping options are being prepared. Your grading payment is saved.',
    TAX_NOT_CONFIGURED:'Shipping tax calculation is not available yet. Your grading payment is saved.',
    SIGN_IN_REQUIRED:'Sign in again to return to this saved order.',
}[typeof error === 'string' ? error : error?.code] ?? 'The shipping request could not be confirmed. Your grading payment and saved cards are unchanged.');

export function ShippingAmounts({ quote, paid = false }) {
    return <div className={styles.shippingSummary} aria-label={paid ? 'Paid shipping' : 'Shipping quote'}>
        <h3>{paid ? 'Shipping payment confirmed' : 'Your shipping quote'}</h3>
        {quote.inboundPackage && <p className={styles.note}>Your package to ATLAS: {quote.inboundPackage.weight.value} {quote.inboundPackage.weight.unit} · {quote.inboundPackage.dimensions.length} × {quote.inboundPackage.dimensions.width} × {quote.inboundPackage.dimensions.height} {quote.inboundPackage.dimensions.unit}</p>}
        <dl>{(quote.shipping ?? []).map((leg,index) => <div key={`${leg.leg}:${index}`}><dt>{leg.leg === 'INBOUND' ? 'Your cards → ATLAS' : leg.leg === 'RETURN' ? 'ATLAS → your address' : 'Shipping'}<small>{[leg.carrierName,leg.serviceName].filter(Boolean).join(' · ')}</small></dt><dd>{money(leg.amountCents)}</dd></div>)}
            <div><dt>Shipping</dt><dd>{money(quote.shippingCents)}</dd></div><div><dt>Tax on shipping</dt><dd>{money(quote.taxCents)}</dd></div>
            <div className={styles.total}><dt>{paid ? 'Shipping paid' : 'Shipping total'}</dt><dd>{money(quote.totalCents)}</dd></div></dl>
        <p className={styles.note}>Your grading payment is separate and will not be charged again.</p>
    </div>;
}

export default function ShippingCheckout({ order, request, onOrder }) {
    const [view,setView] = useState(null), [quote,setQuote] = useState(null), [payment,setPayment] = useState(order.shippingPayment?.activePayment ?? null);
    const [checking,setChecking] = useState(true), [busy,setBusy] = useState(false), [error,setError] = useState(''), [uncertain,setUncertain] = useState(false), [option,setOption] = useState('');
    const [parcel,setParcel] = useState({weight:{unit:'ounce',value:''},dimensions:{unit:'inch',length:'',width:'',height:''}});
    const requestRef = useRef(request), onOrderRef = useRef(onOrder), sequence = useRef(0), operation = useRef(false);
    requestRef.current=request; onOrderRef.current=onOrder;
    const base=`/commerce/orders/${order.id}/shipping`;
    const accept = useCallback(value => {
        if (!value) return;
        if (value.order && value.order.id !== order.id) throw Error('SHIPPING_ORDER_MISMATCH');
        setPayment(value); setUncertain(false);
        if (value.state === 'PAID' && value.order) onOrderRef.current?.(value.order);
    },[order.id]);
    const refresh = useCallback(async () => {
        const id=++sequence.current; setChecking(true); setError(''); setQuote(null); setOption('');
        try {
            const result=await requestRef.current(base);
            if (id !== sequence.current) return;
            if (result.orderId !== order.id) throw Error('SHIPPING_ORDER_MISMATCH');
            setView(result); accept(result.activePayment ?? result.shippingPayment?.activePayment);
        } catch (failure) { if (id === sequence.current) setError(message(failure)); }
        finally { if (id === sequence.current) setChecking(false); }
    },[base,order.id,accept]);
    useEffect(() => { refresh(); return () => { sequence.current++; }; },[refresh]);
    async function run(work) {
        if (operation.current) return;
        operation.current=true; setBusy(true); setError('');
        try { await work(); } catch (failure) { setError(message(failure)); }
        finally { operation.current=false; setBusy(false); }
    }
    const paid=payment?.state === 'PAID' || order.shippingPayment?.state === 'PAID' || view?.shippingPayment?.state === 'PAID';
    const paidReceipt=order.shippingPayment?.receipt ?? view?.shippingPayment?.receipt ?? payment?.order?.shippingPayment?.receipt;
    const selected=option === '' ? null : view?.shippingOptions?.[Number(option)], measured=selected?.inboundPackaging === 'CUSTOMER_MEASURED';
    const measurementsValid=[parcel.weight.value,parcel.dimensions.length,parcel.dimensions.width,parcel.dimensions.height].every(value=>value!==''&&Number.isFinite(Number(value))&&Number(value)>0);
    const locked=busy||checking||Boolean(payment)||uncertain||paid;
    const blockers=view?.blockers ?? [], options=view?.shippingOptions ?? [];
    const available=Boolean(view)&&blockers.length===0&&options.length>0;
    function edit(part,key,value) {
        if (locked) return;
        setParcel(previous=>({...previous,[part]:{...previous[part],[key]:value}})); setQuote(null); setError('');
    }
    async function getQuote() {
        if (locked || !selected || !available || measured&&!measurementsValid) return;
        await run(async () => {
            const result=await requestRef.current(`${base}/quotes`,{body:{packingPresetId:selected.packingPresetId,shippingServiceCode:selected.shippingServiceCode,
                ...(measured ? {inboundPackage:{weight:{unit:parcel.weight.unit,value:Number(parcel.weight.value)},dimensions:{unit:parcel.dimensions.unit,...Object.fromEntries(['length','width','height'].map(key=>[key,Number(parcel.dimensions[key])]))}}} : {})}});
            if (result.orderId !== order.id || result.purpose !== 'SHIPPING') throw Error('SHIPPING_ORDER_MISMATCH');
            setQuote(result);
        });
    }
    async function pay() {
        if (!quote || payment || paid) return;
        await run(async () => {
            const key=`atlas-shipping:${order.id}:${quote.id}`; let requestId=sessionStorage.getItem(key);
            if (!requestId) { requestId=crypto.randomUUID(); sessionStorage.setItem(key,requestId); }
            try { accept(await requestRef.current(`${base}/payments`,{body:{quoteId:quote.id,requestId}})); }
            catch (failure) {
                if (!failure.status || failure.status>=500 || failure.code==='PAYMENT_RECONCILIATION_REQUIRED') setUncertain(true);
                else if (['CHECKOUT_CHANGED','SHIPPING_QUOTE_EXPIRED','SHIPPING_QUOTE_INVALID'].includes(failure.code)) { setUncertain(false); setQuote(null); }
                throw failure;
            }
        });
    }
    async function reconcile() {
        if (!payment) return;
        await run(async () => accept(await requestRef.current(`${base}/payments/${payment.attemptId}/reconcile`,{body:{}})));
    }
    const displayedQuote=payment?.quote ?? quote;
    const expired=quote&&Date.parse(quote.expiresAt)<=Date.now();
    return <section className={styles.separateShipping} aria-label="Separate shipping payment">
        <h3>{paid ? 'Your shipping payment' : 'Shipping is paid separately'}</h3>
        {paid ? <>{paidReceipt ? <ShippingAmounts quote={paidReceipt} paid/> : <p>Your shipping payment is confirmed. Refresh the receipt for the saved shipping details.</p>}<p>Your original grading receipt above stays unchanged.</p></>
            : <p>Your grading payment is confirmed. Shipping has {payment ? 'not yet been confirmed as paid' : 'not been paid'}. Review the carrier quote and tax here before making a separate shipping payment.</p>}
        {!paid && !payment && !uncertain && !available && <p role="status">{checking ? 'Checking shipping availability…' : 'Shipping quotes are not available yet. Keep your cards and return to this receipt to check availability.'}</p>}
        {!paid && !payment && available && <>
            <label className={styles.packaging}>Your package and shipping service<select value={option} disabled={locked} onChange={event=>{if(locked)return;setOption(event.target.value);setQuote(null);setError('');}}><option value="">Choose a package and carrier</option>{options.map((item,index)=><option key={`${item.packingPresetId}:${item.shippingServiceCode}`} value={index}>{[item.carrierLabel,item.serviceLabel,item.label].filter(Boolean).filter((label,index,labels)=>labels.indexOf(label)===index).join(' · ')}</option>)}</select></label>
            <p className={styles.note}>Get the exact cost for your selected service. Changing the service or package measurements requires a fresh quote.</p>
            {measured && <fieldset className={styles.packageFields} disabled={locked}><legend>Your packed shipment to ATLAS</legend><p className={styles.note}>Enter the actual packed weight and outside dimensions.</p><div className={styles.packageGrid}>
                <label>Package weight<input type="number" inputMode="decimal" min="0.001" step="any" value={parcel.weight.value} onChange={event=>edit('weight','value',event.target.value)}/></label>
                <label>Weight unit<select value={parcel.weight.unit} onChange={event=>edit('weight','unit',event.target.value)}>{[['ounce','oz'],['pound','lb'],['gram','g'],['kilogram','kg']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
                {['length','width','height'].map(key=><label key={key}>Package {key}<input type="number" inputMode="decimal" min="0.001" step="any" value={parcel.dimensions[key]} onChange={event=>edit('dimensions',key,event.target.value)}/></label>)}
                <label>Dimension unit<select value={parcel.dimensions.unit} onChange={event=>edit('dimensions','unit',event.target.value)}><option value="inch">inches</option><option value="centimeter">centimeters</option></select></label>
            </div></fieldset>}
        </>}
        {!paid && displayedQuote && <ShippingAmounts quote={displayedQuote}/>}
        {!paid && payment && <div className={styles.payment}><h3>Your shipping payment status</h3><p>{payment.state==='CANCELED' ? 'Your shipping payment was canceled. Your grading payment remains confirmed.' : payment.state==='AWAITING_PAYMENT' ? 'Pay only the separate shipping total below.' : 'We are checking your original shipping payment. Do not pay again.'}</p>
            {payment.state==='AWAITING_PAYMENT'&&payment.clientSecret&&payment.publishableKey&&<PaymentFields payment={payment} onComplete={reconcile}/>}
            <button className={styles.secondary} disabled={busy||checking} onClick={reconcile}>Check shipping payment status</button>
            {payment.state==='CANCELED'&&<button className={styles.secondary} disabled={busy||checking} onClick={()=>{setPayment(null);setQuote(null);}}>Review a new shipping total</button>}
        </div>}
        {!paid && uncertain && !payment && <div className={styles.payment} role="status"><p>The shipping payment reply could not be confirmed. Your original quote and request are retained.</p><button className={styles.primary} disabled={busy||checking} onClick={pay}>Check original shipping payment</button></div>}
        {!paid && !payment && !uncertain && available && <button className={styles.primary} disabled={busy||checking||!selected||measured&&!measurementsValid} onClick={!quote||expired?getQuote:pay}>{busy?'Please wait…':!quote?'Get shipping total':expired?'Refresh shipping total':`Pay shipping ${money(quote.totalCents)}`}</button>}
        {!payment&&!uncertain&&!paid&&<button className={styles.secondary} disabled={busy||checking} onClick={refresh}>{checking?'Checking…':'Check shipping availability'}</button>}
        {error&&<p className={styles.error} role="alert">{error}</p>}
    </section>;
}
