import React,{useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {reviewSoundEnabled,setReviewSound,primeReviewAudio,stopReviewVoice} from '../lib/review-feedback.mjs';

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
