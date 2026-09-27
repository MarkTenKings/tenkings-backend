import { useEffect, useState } from 'react';
import Head from 'next/head';
import Script from 'next/script';

// The same optional heartbeat as the homepage, independent of grading/review state.
export default function ReportGuidance({ reportKey }) {
    const [paused, setPaused] = useState(false);
    useEffect(() => {
        const main = document.querySelector('.public-manual-report');
        if (main) main.dataset.guidancePaused = String(paused);
        document.dispatchEvent(new Event('atlas-guidance-ready'));
    }, [paused, reportKey]);
    return <>
        <Head><link rel="stylesheet" href="/report-guidance.css"/></Head>
        <Script src="/report-guidance.js" type="module" strategy="afterInteractive"/>
        <button type="button" className="report-guidance-toggle" aria-pressed={paused} onClick={() => setPaused(!paused)}>{paused ? 'Resume interaction hints' : 'Pause interaction hints'}</button>
    </>;
}
