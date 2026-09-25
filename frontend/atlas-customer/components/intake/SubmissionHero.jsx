import { useState } from 'react';
import Link from 'next/link';
const cards = ['kobe', 'charizard', 'brady', 'charizard', 'kobe', 'brady'];
export default function SubmissionHero() {
  const [paused, setPaused] = useState(false);
  return <section className={`submission-hero ${paused ? 'paused' : ''}`} aria-labelledby="submission-hero-title">
    <div className="slab-carousel" aria-hidden="true">{[0,1].map(row => <div className={`slab-track track-${row}`} key={row}>{[...cards, ...cards].map((card,index) => <div className={`display-slab slab-${index % 3}`} key={`${card}-${index}`}><div className="display-slab-label"><img src="/account/brand/atlas-grading-logo.png" alt=""/></div><img src={`/account/brand/cards/${card}.jpg`} alt="" loading="lazy"/></div>)}</div>)}</div>
    <div className="submission-hero-scrim"/>
    <div className="submission-hero-copy"><span className="eyebrow">FROM YOUR COLLECTION. TO ITS NEXT CHAPTER.</span><h1 id="submission-hero-title">Great cards.<br/><em>Deserve the spotlight.</em></h1><p>You bring the cards. We reveal every detail.</p></div>
    <Link href="/submit" className="hero-slab-cta"><span className="hero-slab-label"><img src="/account/brand/atlas-grading-logo.png" alt="ATLAS Grading"/></span><span className="hero-slab-window"><span aria-hidden="true">✧</span><strong>GRADE<br/>YOUR CARDS</strong><small>SNAP. SUBMIT. KNOW.</small><span className="hero-slab-button">GRADE YOUR CARDS <span aria-hidden="true">→</span></span></span></Link>
    <div className="hero-bottom"><span>SPORTS + POKÉMON <i>•</i> EVERY DETAIL MATTERS</span><button type="button" onClick={() => setPaused(!paused)} aria-pressed={paused}>{paused ? 'Play motion' : 'Pause motion'}</button></div>
  </section>;
}
