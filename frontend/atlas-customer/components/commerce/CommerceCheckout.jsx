import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './commerce.module.css';
import OrderReceipt, { ServiceSummary, OrderAmounts } from './OrderReceipt.jsx';

const money = value => new Intl.NumberFormat('en-US', { style:'currency',currency:'USD' }).format(value/100);
const friendly = code => ({
    WEEKLY_CAPACITY_FULL:'This week’s card capacity for this route is filled. Your cards are saved; choose another route or return after the next Monday release.',
    WEEKLY_CAPACITY_NOT_CONFIGURED:'Weekly availability is being prepared. Your cards are saved.', PAYMENT_FLOW_CHANGED:'Review a fresh total to pay securely on your phone.',
    COMMERCE_NOT_CONFIGURED:'Checkout is being prepared. Your cards are saved.', TAX_NOT_CONFIGURED:'Tax calculation is not available yet. Your cards are saved.',
    PAYMENT_NOT_CONFIGURED:'Payment is not available yet. Your cards are saved.', SHIPPING_NOT_CONFIGURED:'FedEx shipping is not available yet.',
    MAIL_TURNAROUND_NOT_CONFIGURED:'Mail-in turnaround details are being finalized.', MAIL_SHIPPING_TERMS_NOT_CONFIGURED:'Mail-in shipping details are being finalized.',
    MEASURED_PACKAGING_NOT_CONFIGURED:'Mail-in package sizes and shipping services are being prepared.', LABEL_NOT_READY:'Your saved label is still being prepared. Refresh its status shortly.',
    KIOSK_NOT_AVAILABLE:'This kiosk is not currently available. Choose another location.', TERMINAL_BUSY:'The payment terminal is helping another customer. Please try again shortly.',
    TERMINAL_UNAVAILABLE:'The payment terminal is unavailable. Your cards are saved.', CHECKOUT_CHANGED:'Your submission changed. Review a fresh total before paying.',
    CARD_REVIEW_REQUIRED:'Finish reviewing your cards before checkout.', PAYMENT_RECONCILIATION_REQUIRED:'We are checking your original payment. Do not pay again.',
}[code] ?? 'We could not finish that step. Your saved submission is safe.');

function PaymentFields({ payment, onComplete }) {
    const mount = useRef(null), paymentApi = useRef(null);
    const [ready,setReady] = useState(false), [busy,setBusy] = useState(false), [error,setError] = useState('');
    useEffect(() => {
        let disposed = false, element;
        async function start() {
            try {
                if (!window.Stripe) await new Promise((resolve,reject) => {
                    const existing = document.querySelector('script[data-atlas-payment]');
                    if (existing) { existing.addEventListener('load',resolve,{once:true}); existing.addEventListener('error',reject,{once:true}); return; }
                    const script = document.createElement('script'); script.src='https://js.stripe.com/v3/'; script.dataset.atlasPayment='true';
                    script.onload=resolve; script.onerror=()=>{script.remove();reject();}; document.head.appendChild(script);
                });
                if (disposed) return;
                const stripe = window.Stripe(payment.publishableKey), elements = stripe.elements({ clientSecret:payment.clientSecret,
                    appearance:{theme:'night',variables:{colorPrimary:'#d9b567',borderRadius:'10px'}} });
                element = elements.create('payment'); element.mount(mount.current);
                element.on('ready',() => { if (!disposed) setReady(true); });
                paymentApi.current={stripe,elements};
            } catch { if (!disposed) setError('The secure payment form could not load. Refresh to continue this payment.'); }
        }
        start(); return () => { disposed=true; element?.destroy(); paymentApi.current=null; };
    },[payment.clientSecret,payment.publishableKey]);
    async function submit(event) {
        event.preventDefault(); if (!paymentApi.current || busy) return;
        setBusy(true); setError('');
        try {
            const result = await paymentApi.current.stripe.confirmPayment({elements:paymentApi.current.elements,
                confirmParams:{return_url:window.location.href.split('#')[0]},redirect:'if_required'});
            if (result.error) setError(result.error.message ?? 'Payment was not completed.');
            // This response never marks the order paid. The server retrieves and
            // verifies the exact original provider attempt, even after errors.
            await onComplete();
        } catch { setError('We are checking the original payment. Use Check payment status before continuing.'); }
        finally { setBusy(false); }
    }
    return <form onSubmit={submit}><div ref={mount} className={styles.fields}/>{error && <p role="alert">{error}</p>}
        <button className={styles.primary} disabled={!ready||busy} type="submit">{busy?'Checking payment…':'Pay securely'}</button></form>;
}

export function SavedDraftConfirmation({ draft, onBack }) {
    return <section className={`${styles.panel} ${styles.savedDraft}`} aria-label="Saved submission draft"><span className={styles.savedMark} aria-hidden="true">✓</span><p className={styles.eyebrow}>YOUR LINEUP IS SAFE</p><h2>Your draft is saved.</h2><p>Your {draft.cards.length} {draft.cards.length === 1 ? 'card and its photos are' : 'cards and their photos are'} saved with ATLAS. Checkout is not open yet. You can return to this submission from your account when you’re ready.</p><ol className={styles.cards}>{draft.cards.map((card,index)=><li key={card.id??card.cardId}><span>{String(index+1).padStart(2,'0')}</span><strong>{card.identity?.title??'Card details saved'}</strong></li>)}</ol><p className={styles.note}>This page does not take a payment or confirm an order. Keep your cards until your order and delivery instructions are confirmed.</p><div className={styles.actions}><button type="button" className={styles.secondary} onClick={onBack}>View saved cards</button><a href="/account" className={styles.primary}>Back to your account →</a></div></section>;
}

export default function CommerceCheckout({ draft, request, onPaid, onBack }) {
    const draftId=draft?.id??draft?.draftId, [view,setView]=useState(null), [quote,setQuote]=useState(null), [payment,setPayment]=useState(null),
        [order,setOrder]=useState(null), [checkoutUnavailable,setCheckoutUnavailable]=useState(false), [busy,setBusy]=useState(false), [error,setError]=useState(''), [option,setOption]=useState('');
    const notified=useRef(null),callback=useRef(onPaid),requestRef=useRef(request);callback.current=onPaid;requestRef.current=request;
    const accept = useCallback(value => {
        setPayment(value);
        if(value?.state==='PAID'&&value.order) { setOrder(value.order); if(notified.current!==value.order.id){notified.current=value.order.id;callback.current?.(value.order);} }
    },[]);
    useEffect(() => { let disposed=false;
        requestRef.current(`/api/customer/commerce/checkout?draftId=${encodeURIComponent(draftId)}`,{method:'GET'}).then(value => {
            if(disposed)return; setView(value); setCheckoutUnavailable(value.blockers?.some(code=>['COMMERCE_NOT_CONFIGURED','PAYMENT_NOT_CONFIGURED'].includes(code))??false); if(value.activePayment)accept(value.activePayment);
        }).catch(err => {if(!disposed) { if((err.code??err.message)==='COMMERCE_NOT_CONFIGURED')setCheckoutUnavailable(true); else setError(friendly(err.code??err.message)); }});
        return () => {disposed=true;};
    },[draftId,accept]);
    async function run(fn) { if(busy)return; setBusy(true);setError('');try{await fn();}catch(err){setError(friendly(err.code??err.message));}finally{setBusy(false);} }
    async function getQuote() { const selected=view?.shippingOptions?.[Number(option)];
        await run(async()=>setQuote(await request('/api/customer/commerce/quotes',{method:'POST',body:{draftId,expectedRevision:view.revision,
            ...(selected?{packingPresetId:selected.packingPresetId,shippingServiceCode:selected.shippingServiceCode}:{})}}))); }
    async function pay() { await run(async()=>{
        const key=`atlas-checkout:${draftId}:${quote.id}`;let requestId=sessionStorage.getItem(key);
        if(!requestId){requestId=crypto.randomUUID();sessionStorage.setItem(key,requestId);}
        accept(await request('/api/customer/commerce/payments',{method:'POST',body:{quoteId:quote.id,requestId}}));
    }); }
    async function reconcile() { if(!payment)return; await run(async()=>accept(await request(`/api/customer/commerce/payments/${payment.attemptId}/reconcile`,{method:'POST',body:{}}))); }
    const kiosk=(quote?.channel??view?.channel??draft?.channel??(draft?.intakeMethod==='DEALER_DROP_OFF'?'KIOSK':'MAIL_IN'))==='KIOSK';
    const phonePayment=(payment?.paymentFlow??quote?.terms?.paymentFlow)==='CUSTOMER_PHONE'||!kiosk;
    const awaiting=payment?.state==='AWAITING_PAYMENT';
    const quoteExpired=quote&&Date.parse(quote.expiresAt)<=Date.now();
    if(checkoutUnavailable&&!payment&&!order) return <SavedDraftConfirmation draft={draft} onBack={onBack}/>;
    if(order) return <OrderReceipt initialOrder={order} request={request}/>;
    return <section className={styles.panel} aria-label="Review and checkout"><p className={styles.eyebrow}>REVIEW & CHECKOUT</p><h2>Ready for the next chapter.</h2>
        <ServiceSummary snapshot={quote??{channel:kiosk?'KIOSK':'MAIL_IN',location:view?.location,unitCents:view?.unitCents??(kiosk?5000:4000)}}/>
        <ol className={styles.cards}>{(view?.cards??draft?.cards??[]).map((card,index)=><li key={card.id??card.cardId}><span>{String(index+1).padStart(2,'0')}</span><strong>{card.identity?.title??card.identity?.playerName??'Card details saved'}</strong></li>)}</ol>
        {view?.blockers?.length>0&&<p role="status">{[...new Set(view.blockers.map(friendly))].join(' ')}</p>}
        {!kiosk&&view?.shippingOptions?.length>0&&!quote&&<label className={styles.packaging}>Your package and FedEx service<select value={option} onChange={event=>setOption(event.target.value)}><option value="">Choose measured packaging</option>{view.shippingOptions.map((item,index)=><option key={`${item.packingPresetId}:${item.shippingServiceCode}`} value={index}>{item.label}</option>)}</select></label>}
        {quote&&<OrderAmounts snapshot={quote}/>}
        {payment&&<div className={styles.payment}><h3>{!awaiting?'Your payment status':phonePayment?'Pay securely on your phone':'Continue at this kiosk’s terminal'}</h3>
            <p>{payment.state==='CANCELED'?'This payment was canceled. Review a new total below.':!awaiting?'We are checking your original payment. Please do not pay again.':phonePayment?'Use an available wallet or enter your card below. Your order is confirmed only after payment is verified.':'Tap or insert your card at the linked terminal. Your order is confirmed only after the payment is verified.'}</p>
            {phonePayment&&payment.clientSecret&&payment.publishableKey&&<PaymentFields payment={payment} onComplete={reconcile}/>}
            <button className={styles.secondary} disabled={busy} onClick={reconcile}>Check payment status</button></div>}
        {payment?.state==='CANCELED'&&<button className={styles.secondary} disabled={busy} onClick={()=>{setPayment(null);setQuote(null);}}>Payment canceled · Review a new total</button>}
        {error&&<p className={styles.error} role="alert">{error}</p>}
        {!payment&&<div className={styles.actions}><button className={styles.secondary} disabled={busy} onClick={onBack}>Back to cards</button>
            {!quote||quoteExpired?<button className={styles.primary} disabled={busy||!view||view.blockers?.length>0||(!kiosk&&option==='')} onClick={getQuote}>{busy?'Calculating…':quoteExpired?'Refresh exact total':'Get exact total'}</button>
                :<button className={styles.primary} disabled={busy} onClick={pay}>{busy?'Connecting…':`Pay ${money(quote.totalCents)}`}</button>}</div>}
    </section>;
}
