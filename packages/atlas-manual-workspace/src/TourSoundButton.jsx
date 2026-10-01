import React,{useEffect,useState} from 'react';
import {createTourSound} from './evidence-tour-sound.mjs';
export function TourSoundButton({controller,plan}){
  const [sound,setSound]=useState(null),[enabled,setEnabled]=useState(false);
  useEffect(()=>{const owner=createTourSound({controller,plan});setSound(owner);setEnabled(false);return()=>owner.dispose();},[controller,plan]);
  return <button type="button" aria-pressed={enabled} disabled={!sound} onClick={async()=>setEnabled(await sound.setEnabled(!enabled))}>{enabled?'Sound on':'Sound off'}</button>;
}
