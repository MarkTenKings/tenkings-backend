import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './commerce.module.css';
import OrderReceipt, { ServiceSummary, OrderAmounts } from './OrderReceipt.jsx';
import PaymentFields from './PaymentFields.jsx';

const money = value => new Intl.NumberFormat('en-US', { style:'currency',currency:'USD' }).format(value/100);
const friendly = code => ({
    WEEKLY_CAPACITY_FULL:'This week’s shared card capacity is filled across both routes. Your cards are saved; check back for new availability.',
    WEEKLY_CAPACITY_NOT_CONFIGURED:'Weekly availability is being prepared. Your cards are saved.', PAYMENT_FLOW_CHANGED:'Review a fresh total to pay securely on your phone.',
    COMMERCE_NOT_CONFIGURED:'Checkout is being prepared. Your cards are saved.', TAX_NOT_CONFIGURED:'Tax calculation is not available yet. Your cards are saved.',
    PAYMENT_NOT_CONFIGURED:'Payment is not available yet. Your cards are saved.', SHIPPING_NOT_CONFIGURED:'Shipping quotes are not available yet.', PACKAGE_EXCEEDS_PARCEL_LIMITS:'That package exceeds the supported parcel size or weight. Check your measurements or use a smaller package.', MEASURED_PACKAGE_REQUIRED:'Enter the actual weight and outside dimensions of your packed shipment.', SHIPSTATION_RATE_UNAVAILABLE:'That shipping service could not be quoted. Choose another available service or try again.', SHIPSTATION_REQUEST_FAILED:'Shipping is unavailable right now. Your cards are saved; try again later.', INBOUND_PACKAGE_REQUIRED:'Enter the actual weight and outside dimensions of your packed shipment.', INBOUND_PACKAGE_INVALID:'Check the weight and outside dimensions of your packed shipment.',
    MAIL_TURNAROUND_NOT_CONFIGURED:'Mail-in turnaround details are being finalized.', MAIL_SHIPPING_TERMS_NOT_CONFIGURED:'Mail-in shipping details are being finalized.',
    MEASURED_PACKAGING_NOT_CONFIGURED:'Mail-in package sizes and shipping services are being prepared.', LABEL_NOT_READY:'Your saved label is still being prepared. Refresh your receipt to check its status.',
    KIOSK_NOT_AVAILABLE:'This kiosk is not currently available. Choose another location.', TERMINAL_BUSY:'The payment terminal is helping another customer. Please try again shortly.',
    TERMINAL_UNAVAILABLE:'The payment terminal is unavailable. Your cards are saved.', CHECKOUT_CHANGED:'Your submission changed. Review a fresh total before paying.',
    PACKAGING_REQUIRED:'Choose a package and shipping service before requesting your total.', SHIPPING_QUOTE_INVALID:'That shipping service could not be quoted. Choose another available service or try again.', SHIPPING_PROVIDER_UNAVAILABLE:'That shipping service is unavailable right now. Try again later.', CARD_REVIEW_REQUIRED:'Finish reviewing your cards before checkout.', PAYMENT_RECONCILIATION_REQUIRED:'We are checking your original payment. Do not pay again.',
}[code] ?? 'We could not finish that step. Your saved submission is safe.');


export function SavedDraftConfirmation({ draft, onCheckAvailability, checking = false, error = '' }) {
    return <section className={`${styles.panel} ${styles.savedDraft}`} aria-label="Saved submission draft"><p className={styles.eyebrow}>YOUR DRAFT IS SAVED</p><h2>Checkout is not open yet.</h2><p>Your {draft.cards.length} {draft.cards.length === 1 ? 'card and its photos are' : 'cards and their photos are'} saved with ATLAS. You don’t need to upload or review them again. Check availability here to continue when checkout opens.</p><ol className={styles.cards}>{draft.cards.map((card,index)=><li key={card.id??card.cardId}><span>{String(index+1).padStart(2,'0')}</span><strong>{card.identity?.title??'Card details saved'}</strong></li>)}</ol><p className={styles.note}>This page does not take a payment or confirm an order. Keep your cards until your order and delivery instructions are confirmed.</p>{error && <p className={styles.error} role="alert">{error}</p>}<div className={styles.actions}><button type="button" className={styles.primary} disabled={checking} onClick={onCheckAvailability}>{checking ? 'Checking availability…' : 'Check checkout availability'}</button><a href="/account" className={styles.secondary}>Back to your account →</a></div></section>;
}

export default function CommerceCheckout({ draft, request, onPaid, onBack }) {
    const draftId=draft?.id??draft?.draftId, [view,setView]=useState(null), [quote,setQuote]=useState(null), [payment,setPayment]=useState(null),
        [order,setOrder]=useState(null), [checkoutUnavailable,setCheckoutUnavailable]=useState(false), [checking,setChecking]=useState(true), [busy,setBusy]=useState(false), [error,setError]=useState(''), [option,setOption]=useState(''), [paymentUnconfirmed,setPaymentUnconfirmed]=useState(false),
        [inboundPackage,setInboundPackage]=useState({weight:{unit:'ounce',value:''},dimensions:{unit:'inch',length:'',width:'',height:''}});
    const notified=useRef(null),callback=useRef(onPaid),requestRef=useRef(request);callback.current=onPaid;requestRef.current=request;
    const checkoutRead=useRef(0), operation=useRef(false);
    const accept = useCallback(value => {
        setPayment(value); if(value)setPaymentUnconfirmed(false);
        if(value?.state==='PAID'&&value.order) { setOrder(value.order); if(notified.current!==value.order.id){notified.current=value.order.id;callback.current?.(value.order);} }
    },[]);
    const checkAvailability = useCallback(async () => {
        const read=++checkoutRead.current; setChecking(true);setError('');
        try {
            const value=await requestRef.current(`/api/customer/commerce/checkout?draftId=${encodeURIComponent(draftId)}`,{method:'GET'});
            if(read!==checkoutRead.current)return;
            setView(value);setCheckoutUnavailable(value.blockers?.some(code=>['COMMERCE_NOT_CONFIGURED','PAYMENT_NOT_CONFIGURED'].includes(code))??false);
            // An existing payment always takes precedence over today's gates.
            // Checking availability never creates a quote or another payment.
            if(value.activePayment)accept(value.activePayment);
        } catch(err) {
            if(read!==checkoutRead.current)return;
            if((err.code??err.message)==='COMMERCE_NOT_CONFIGURED')setCheckoutUnavailable(true);
            else setError(friendly(err.code??err.message));
        } finally {if(read===checkoutRead.current)setChecking(false);}
    },[draftId,accept]);
    useEffect(() => {checkAvailability();return () => {checkoutRead.current++;};},[checkAvailability]);
    async function run(fn) { if(operation.current)return; operation.current=true;setBusy(true);setError('');try{await fn();}catch(err){setError(friendly(err.code??err.message));}finally{operation.current=false;setBusy(false);} }
    const kiosk=(quote?.channel??view?.channel??draft?.channel??(draft?.intakeMethod==='DEALER_DROP_OFF'?'KIOSK':'MAIL_IN'))==='KIOSK';
    const separateShipping=!kiosk&&(quote?.terms?.shippingPayment??view?.terms?.shippingPayment)==='SEPARATE_PAYMENT';
    const selectedOption=separateShipping||option===''?null:view?.shippingOptions?.[Number(option)];
    const needsMeasurements=selectedOption?.inboundPackaging==='CUSTOMER_MEASURED';
    const validMeasurements=[inboundPackage.weight.value,...['length','width','height'].map(key=>inboundPackage.dimensions[key])].every(value=>value!==''&&Number.isFinite(Number(value))&&Number(value)>0);
    function updatePackage(part,key,value){if(busy||payment||paymentUnconfirmed)return;setInboundPackage(previous=>({...previous,[part]:{...previous[part],[key]:value}}));setQuote(null);setError('');}
    async function getQuote() { if(payment||paymentUnconfirmed||needsMeasurements&&!validMeasurements)return;const selected=selectedOption;
        await run(async()=>setQuote(await request('/api/customer/commerce/quotes',{method:'POST',body:{draftId,expectedRevision:view.revision,
            ...(selected?{packingPresetId:selected.packingPresetId,shippingServiceCode:selected.shippingServiceCode}:{}),
            ...(needsMeasurements?{inboundPackage:{weight:{unit:inboundPackage.weight.unit,value:Number(inboundPackage.weight.value)},dimensions:{unit:inboundPackage.dimensions.unit,...Object.fromEntries(['length','width','height'].map(key=>[key,Number(inboundPackage.dimensions[key])]))}}}:{})}}))); }
    async function pay() { await run(async()=>{
        const key=`atlas-checkout:${draftId}:${quote.id}`;let requestId=sessionStorage.getItem(key);
        if(!requestId){requestId=crypto.randomUUID();sessionStorage.setItem(key,requestId);}
        try { accept(await request('/api/customer/commerce/payments',{method:'POST',body:{quoteId:quote.id,requestId}})); }
        catch(err) {
            // A lost reply is not proof that payment creation failed. Retain
            // this quote and retry only its original durable request identity.
            if(!err.status||err.status>=500||err.code==='PAYMENT_RECONCILIATION_REQUIRED')setPaymentUnconfirmed(true);
            else if(['CHECKOUT_CHANGED','WEEKLY_CAPACITY_FULL','PROFILE_EMAIL_REQUIRED','EMAIL_VERIFICATION_REQUIRED','PAYMENT_FLOW_CHANGED'].includes(err.code)) {setPaymentUnconfirmed(false);setQuote(null);}
            throw err;
        }
    }); }
    async function reconcile() { if(!payment)return; await run(async()=>accept(await request(`/api/customer/commerce/payments/${payment.attemptId}/reconcile`,{method:'POST',body:{}}))); }
    const phonePayment=(payment?.paymentFlow??quote?.terms?.paymentFlow)==='CUSTOMER_PHONE'||!kiosk;
    const awaiting=payment?.state==='AWAITING_PAYMENT';
    const quoteExpired=quote&&Date.parse(quote.expiresAt)<=Date.now();
    if(checkoutUnavailable&&!payment&&!order) return <SavedDraftConfirmation draft={draft} onCheckAvailability={checkAvailability} checking={checking} error={error}/>;
    if(order) return <OrderReceipt initialOrder={order} request={request}/>;
    return <section className={styles.panel} aria-label="Review and checkout"><p className={styles.eyebrow}>REVIEW & CHECKOUT</p><h2>Ready for the next chapter.</h2>
        <ServiceSummary snapshot={quote??{channel:kiosk?'KIOSK':'MAIL_IN',location:view?.location,terms:view?.terms,unitCents:view?.unitCents??(kiosk?5000:4000)}}/>
        <ol className={styles.cards}>{(view?.cards??draft?.cards??[]).map((card,index)=><li key={card.id??card.cardId}><span>{String(index+1).padStart(2,'0')}</span><strong>{card.identity?.title??card.identity?.playerName??'Card details saved'}</strong></li>)}</ol>
        {view?.blockers?.length>0&&<p role="status">{[...new Set(view.blockers.map(friendly))].join(' ')}</p>}
        {!kiosk&&!separateShipping&&view?.shippingOptions?.length>0&&!payment&&<div className={styles.shippingChoice}><label className={styles.packaging}>Your package and shipping service<select value={option} disabled={busy||paymentUnconfirmed} onChange={event=>{setOption(event.target.value);setQuote(null);setError('');}}><option value="">Choose a package and carrier</option>{view.shippingOptions.map((item,index)=><option key={`${item.packingPresetId}:${item.shippingServiceCode}`} value={index}>{[item.carrierLabel,item.serviceLabel,item.label].filter(Boolean).filter((label,index,labels)=>labels.indexOf(label)===index).join(' · ')}</option>)}</select></label><p className={styles.note}>Choose the package you will use. Get the exact shipping cost and tax before paying. Changing the service requires a fresh total.</p></div>}
        {!kiosk&&needsMeasurements&&!payment&&<fieldset className={styles.packageFields} disabled={busy||paymentUnconfirmed}><legend>Your packed shipment to ATLAS</legend><p className={styles.note}>Pack your cards securely, then weigh the complete package and measure its outside length, width and height. Use these actual measurements for your label.</p><div className={styles.packageGrid}><label>Package weight<input type="number" inputMode="decimal" min="0.001" step="any" value={inboundPackage.weight.value} onChange={event=>updatePackage('weight','value',event.target.value)}/></label><label>Weight unit<select value={inboundPackage.weight.unit} onChange={event=>updatePackage('weight','unit',event.target.value)}>{[['ounce','oz'],['pound','lb'],['gram','g'],['kilogram','kg']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>{['length','width','height'].map(key=><label key={key}>Package {key}<input type="number" inputMode="decimal" min="0.001" step="any" value={inboundPackage.dimensions[key]} onChange={event=>updatePackage('dimensions',key,event.target.value)}/></label>)}<label>Dimension unit<select value={inboundPackage.dimensions.unit} onChange={event=>updatePackage('dimensions','unit',event.target.value)}><option value="inch">inches</option><option value="centimeter">centimeters</option></select></label></div></fieldset>}
        {quote&&<OrderAmounts snapshot={quote}/>}
        {payment&&<div className={styles.payment}><h3>{!awaiting?'Your payment status':phonePayment?'Pay securely on your phone':'Continue at this kiosk’s terminal'}</h3>
            <p>{payment.state==='CANCELED'?'This payment was canceled. Review a new total below.':!awaiting?'We are checking your original payment. Please do not pay again.':phonePayment?'Use an available wallet or enter your card below. Your order is confirmed only after payment is verified.':'Tap or insert your card at the linked terminal. Your order is confirmed only after the payment is verified.'}</p>
            {phonePayment&&payment.clientSecret&&payment.publishableKey&&<PaymentFields payment={payment} onComplete={reconcile}/>}
            <button className={styles.secondary} disabled={busy} onClick={reconcile}>Check payment status</button></div>}
        {payment?.state==='CANCELED'&&<button className={styles.secondary} disabled={busy} onClick={()=>{setPayment(null);setQuote(null);}}>Payment canceled · Review a new total</button>}
        {paymentUnconfirmed&&!payment&&<div className={styles.payment} role="status"><h3>Check your original payment</h3><p>The payment reply could not be confirmed. Your selected shipping and total are retained while we check the same payment request.</p><button className={styles.primary} disabled={busy} onClick={pay}>{busy?'Checking payment…':'Check original payment'}</button></div>}
        {error&&<p className={styles.error} role="alert">{error}</p>}
        {!payment&&!paymentUnconfirmed&&<div className={styles.actions}><button className={styles.secondary} disabled={busy} onClick={onBack}>Back to cards</button>
            {!quote||quoteExpired?<button className={styles.primary} disabled={busy||!view||view.blockers?.length>0||(!kiosk&&!separateShipping&&option==='')||(needsMeasurements&&!validMeasurements)} onClick={getQuote}>{busy?'Calculating…':quoteExpired?'Refresh exact total':separateShipping?'Get grading total':'Get exact total'}</button>
                :<button className={styles.primary} disabled={busy} onClick={pay}>{busy?'Connecting…':`Pay ${money(quote.totalCents)}`}</button>}</div>}
    </section>;
}
