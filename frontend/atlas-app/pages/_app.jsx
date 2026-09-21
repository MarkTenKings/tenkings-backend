import { useEffect, useLayoutEffect, useState } from 'react';
import Router from 'next/router';
import { installPendingNavigationController } from '../lib/pending-navigation.mjs';
import '../styles/global.css';
import '../styles/grading.css';
import '@atlas/report-view/styles.css';
import '@atlas/manual-workspace/styles.css';
import '@atlas/manual-workspace/defects.css';
import '@atlas/manual-workspace/report-review.css';
import '../styles/manual.css';
const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
export default function App({ Component, pageProps }) {
    const [navigationNotice,setNavigationNotice]=useState('');
    useBrowserLayoutEffect(()=>installPendingNavigationController({window,document,router:Router,onBlocked:setNavigationNotice}),[]);
    return <>{navigationNotice && <aside role="alert" style={{position:'fixed',top:'1rem',right:'1rem',zIndex:10000,maxWidth:'32rem',marginLeft:'1rem',padding:'1rem',border:'1px solid #a33',borderRadius:8,background:'#fff',color:'#251d1d',boxShadow:'0 4px 24px #0003'}}>
        <p>{navigationNotice}</p><button type="button" onClick={()=>setNavigationNotice('')}>Dismiss message</button></aside>}<Component {...pageProps}/></>;
}
