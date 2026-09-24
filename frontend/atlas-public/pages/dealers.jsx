import Head from 'next/head';
import Link from 'next/link';
import {useEffect,useMemo,useRef,useState} from 'react';
import DealerMap from '../components/DealerMap';
import {dealerDirectory} from '../lib/server/dealers.mjs';
import {dealerDirections,selectDealers} from '../lib/dealers.mjs';
export function getServerSideProps({query,res}) {
  res.setHeader('Cache-Control','no-store');
  try { return {props:{...dealerDirectory(),initialService:query.service==='buy'?'BUY':query.service==='submit'?'SUBMIT':'ALL',initialDealer:typeof query.dealer==='string'?query.dealer:null}}; }
  catch { res.statusCode=503;return {props:{dealers:[],map:null,initialService:'ALL',unavailable:true}}; }
}
const money=(amount,currency)=>{const formatter=new Intl.NumberFormat('en-US',{style:'currency',currency});return formatter.format(amount/10**formatter.resolvedOptions().maximumFractionDigits);};
export default function Dealers({dealers,map,initialService,initialDealer,unavailable}) {
  const [query,setQuery]=useState(''),[service,setService]=useState(initialService),[position,setPosition]=useState(null),[locationStatus,setLocationStatus]=useState(''),[selected,setSelected]=useState(initialDealer),[locating,setLocating]=useState(false);
  const visible=useMemo(()=>selectDealers(dealers,{query,service,position}),[dealers,query,service,position]);
  const cards=useRef(new Map());
  useEffect(()=>{
    const card=cards.current.get(initialDealer);
    if(!card)return;
    setSelected(initialDealer);
    card.scrollIntoView({block:'nearest',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
    card.focus({preventScroll:true});
  },[initialDealer]);
  const select=id=>{setSelected(id);cards.current.get(id)?.scrollIntoView({block:'nearest',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});cards.current.get(id)?.focus({preventScroll:true});};
  const locate=()=>{
    if(!navigator.geolocation){setLocationStatus('Location is unavailable. Search your city or postal code.');return;}
    setLocating(true);setLocationStatus('Finding nearby dealers…');
    navigator.geolocation.getCurrentPosition(result=>{setPosition({lat:result.coords.latitude,lng:result.coords.longitude});setLocating(false);setLocationStatus('Sorted by approximate distance.');},()=>{setLocating(false);setLocationStatus('Location was not shared. Search your city or postal code.');},{timeout:10000,maximumAge:300000,enableHighAccuracy:false});
  };
  return <main className="dealer-page"><Head><title>Authorized dealers · ATLAS Grading</title><meta name="description" content="Find an authorized ATLAS dealer to discuss selling your graded card or submitting cards for grading."/></Head>
    <header className="dealer-header"><Link href="/" aria-label="ATLAS home"><img src="/brand/atlas-brand.png" alt="ATLAS"/></Link><Link href="/account">Your account <span aria-hidden="true">↗</span></Link></header>
    <section className="dealer-hero"><span className="dealer-eyebrow">THE ATLAS NETWORK</span><h1>Your next move.<br/><em>Closer than you think.</em></h1><p>Sell a graded card. Submit your next one. Find an authorized ATLAS partner.</p></section>
    <section className="dealer-tools" aria-label="Find a dealer"><div className="dealer-filters">{[['ALL','All dealers'],['BUY','Sell a card'],['SUBMIT','Submit for grading']].map(([value,label])=><button key={value} aria-pressed={service===value} onClick={()=>setService(value)}>{label}</button>)}</div>
      <div className="dealer-search"><label><span className="sr-only">Search dealer name, city or postal code</span><input type="search" placeholder="Name, city or postal code" value={query} onChange={e=>setQuery(e.target.value)}/></label><button onClick={locate} disabled={locating||!dealers.some(d=>d.position)}>{locating?'Locating…':'Near me'} <span aria-hidden="true">⌖</span></button></div>
      {locationStatus&&<p className="dealer-location-status" role="status">{locationStatus}</p>}
    </section>
    <DealerMap configuration={map} dealers={visible} onSelect={select}/>
    <div className="dealer-result-heading"><span>{visible.length} {visible.length===1?'partner':'partners'}</span><span>AUTHORIZED BY ATLAS</span></div>
    {!visible.length?<section className="dealer-empty"><span aria-hidden="true">◇</span><h2>{unavailable?'The directory is temporarily unavailable.':dealers.length?'No matching dealers.':'The network is taking shape.'}</h2><p>{unavailable?'Please try again shortly.':dealers.length?'Try another city, dealer name or service.':'Authorized locations and their service details will appear here as they are added.'}</p><Link href="/account">Your grading account <span aria-hidden="true">↗</span></Link></section>:
    <section className="dealer-results" aria-label="Matching authorized dealers">{visible.map(dealer=><article key={dealer.id} tabIndex={-1} ref={node=>node?cards.current.set(dealer.id,node):cards.current.delete(dealer.id)} className={`dealer-card ${selected===dealer.id?'is-selected':''}`}>
      <div className="dealer-card-top"><span className="dealer-monogram" aria-hidden="true">{dealer.name.slice(0,1)}</span><div><p>{dealer.address.city}, {dealer.address.region}</p><h2>{dealer.name}</h2></div>{dealer.distanceMiles!==null&&<span className="dealer-distance">{dealer.distanceMiles<1?'<1':Math.round(dealer.distanceMiles)} mi<small>approx.</small></span>}</div>
      <div className="dealer-services">{dealer.contactOnly&&<span>Contact for service availability</span>}{dealer.services.includes('BUY')&&<span>Buys graded cards</span>}{dealer.services.includes('SUBMIT')&&<span>Grading submissions</span>}</div>
      <address>{dealer.address.line1}<br/>{dealer.address.city}, {dealer.address.region} {dealer.address.postalCode}</address>
      {dealer.contactOnly&&<p className="dealer-contact-note">Contact this partner to confirm buying availability, ATLAS submission arrangements and current terms before visiting.</p>}
      {dealer.programs.map((p,index)=><div className="dealer-program" key={index}><div><strong>{p.name}</strong><b>{money(p.priceMinor,p.currency)}</b></div><p>{p.turnaroundBusinessDays.min}–{p.turnaroundBusinessDays.max} business days</p><details><summary>Program terms</summary><p>{p.terms}</p><p>Terms valid through {p.expiresAt.slice(0,10)}.</p></details></div>)}
      <div className="dealer-actions"><a href={dealerDirections(dealer)} target="_blank" rel="noopener noreferrer">Directions ↗</a>{dealer.website&&<a href={dealer.website} target="_blank" rel="noopener noreferrer">{dealer.contactOnly?'Contact dealer':service==='BUY'?'Ask about selling':'Visit dealer'} ↗</a>}{dealer.phone&&<a href={`tel:${dealer.phone}`}>Call</a>}</div>
    </article>)}</section>}
    <footer className="dealer-footer"><p>Each dealer sets its buying terms. Contact the dealer for a card-specific offer and current submission instructions.</p><Link href="/">ATLAS · Know what you have</Link></footer>
  </main>;
}
