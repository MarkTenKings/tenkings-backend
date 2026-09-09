import Head from 'next/head';
import { publicHeaders } from '../lib/server/policy.mjs';
export async function getServerSideProps(ctx) {
    publicHeaders(ctx.res);
    return { props: {} };
}
export default function Home() {
    return <main className="public-page account-entry"><Head><title>ATLAS Grading</title><meta name="robots" content="noindex,nofollow"/></Head>
        <header className="public-header"><div className="brand">ATLAS<span>GRADING</span></div>
            <a href="/account" className="entry-link">Sign in</a></header>
        <section className="entry-intro"><p className="eyebrow">YOUR CARDS. EVERY STEP.</p><h1>Every grade has a report.</h1>
            <p className="muted">Submit your cards, follow their progress and return to your approved grading reports, all from your ATLAS account.</p>
            <div className="entry-actions"><a className="entry-primary" href="/account">Submit cards</a><a className="entry-link" href="/account">Track my cards →</a></div>
            <p className="muted">Sign in with your mobile number. Choose dealer drop-off or mail-in when you submit.</p>
        </section>
        <section className="entry-report"><h2>Already have an ATLAS card?</h2>
            <p className="muted">Open the report link on your ATLAS label to see its approved grade, photographs and findings.</p>
        </section>
        <footer className="entry-footer"><span>ATLAS GRADING</span><a className="entry-link" href="/admin">Staff sign in</a></footer>
    </main>;
}
