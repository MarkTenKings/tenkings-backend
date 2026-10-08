import { useEffect, useRef, useState } from 'react';
import styles from './commerce.module.css';

export default function PaymentFields({ payment, onComplete }) {
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

