import { useEffect, useLayoutEffect, useState } from 'react';
import Router from 'next/router';
import { installPendingNavigationController } from '../lib/pending-navigation.mjs';
import '../styles/global.css';
import '../styles/grading.css';
import '@atlas/report-view/styles.css';
import '@atlas/manual-workspace/styles.css';
import '@atlas/manual-workspace/defects.css';
import '../styles/manual.css';
import '../styles/atlas-brand.css';
import '../styles/atlas-theme.css';
import '@atlas/manual-workspace/report-review.css';
const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
export default function App({ Component, pageProps }) {
    const [navigationNotice,setNavigationNotice]=useState('');
    useBrowserLayoutEffect(()=>installPendingNavigationController({window,document,router:Router,onBlocked:setNavigationNotice}),[]);
    return <>{navigationNotice && <aside role="alert" className="atlas-navigation-notice">
        <p>{navigationNotice}</p><button type="button" onClick={()=>setNavigationNotice('')}>Dismiss message</button></aside>}<Component {...pageProps}/></>;
}
