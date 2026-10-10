import React,{useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {reviewSoundEnabled,setReviewSound,primeReviewAudio,stopReviewVoice} from '../lib/review-feedback.mjs';
import styles from './BatchGrading.module.css';

/** Direct card routes share the modal's bounded review surface and action dock. */
export function DirectCardReviewShell({children,title,busy=false,onExit}) {
  useEffect(()=>{const overflow=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{document.body.style.overflow=overflow;};},[]);
  return <section className={`${styles.rapidDialog} ${styles.directReview}`} aria-label="Card review workspace">
    <header className={styles.rapidHeader}><div><small>ATLAS INSPECT</small><h2>Review card <span>· {title||'Card'}</span></h2></div><div className={styles.rapidHeaderTools}><AtlasSoundControl/><button type="button" disabled={busy} onClick={onExit}>All cards</button></div></header>
    <div className={styles.rapidBody}>{children}</div>
    <footer id="atlas-rapid-actions" className="mc-rapid-actions" aria-label="Review controls"><div id="atlas-rapid-edits" className="mc-rapid-edit-dock"/></footer>
  </section>;
}

/** The native modal owns this destination, outside every scrollable editor. */
export function RapidActionDock({children,targetId='atlas-rapid-actions'}) {
  const [target,setTarget]=useState(null);
  useEffect(()=>{setTarget(document.getElementById(targetId));},[targetId]);
  return target ? createPortal(children,target) : null;
}
export function AtlasSoundControl() {
  const [enabled,setEnabled]=useState(true);
  useEffect(()=>{setEnabled(reviewSoundEnabled());return stopReviewVoice;},[]);
  return <button type="button" aria-pressed={enabled} aria-label={enabled?'Mute review sounds':'Enable review sounds'} onClick={()=>{const next=!enabled;setEnabled(next);setReviewSound(next);if(next)primeReviewAudio();}}>{enabled?'♫ Sound on':'♫ Sound off'}</button>;
}

export function RapidEditDock({children,side}) { return <RapidActionDock targetId="atlas-rapid-edits"><div className="mc-rapid-edit-actions"><span>{side==='FRONT'?'Front':'Back'}</span>{children}</div></RapidActionDock>; }
