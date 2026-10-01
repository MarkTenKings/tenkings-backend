import {sampleEdgeTour} from './evidence-edge-tour.mjs';

// One sound owner for the paired viewer. Scrubbing and passive report loads
// never request audio; enabling it is an explicit user gesture.
export function createTourSound({controller,plan,createContext=()=>new (window.AudioContext||window.webkitAudioContext)()}){
  let context=null,enabled=false,lastKey=null,disposed=false;
  const unsubscribe=controller.subscribe(state=>{
    const sample=(plan.sample??sampleEdgeTour)(plan,state.progress),key=sample.kind==='inspect'?sample.key:null;
    if(key===lastKey)return;
    lastKey=key;
    if(!enabled||!state.playing||!key||context?.state!=='running')return;
    try{
      const tone=context.createOscillator(),gain=context.createGain(),now=context.currentTime;
      tone.type='sine';tone.frequency.setValueAtTime(740,now);
      gain.gain.setValueAtTime(0,now);gain.gain.linearRampToValueAtTime(.025,now+.015);gain.gain.exponentialRampToValueAtTime(.0001,now+.14);
      tone.connect(gain);gain.connect(context.destination);tone.start(now);tone.stop(now+.15);
      tone.onended=()=>{tone.disconnect();gain.disconnect();};
    }catch{}
  });
  return {
    async setEnabled(value){
      if(disposed)return false;
      enabled=false;
      if(!value)return false;
      try{context??=createContext();if(context.state==='suspended')await context.resume();enabled=!disposed&&context.state==='running';}catch{enabled=false;}
      return enabled;
    },
    dispose(){disposed=true;enabled=false;unsubscribe();void context?.close?.().catch?.(()=>{});context=null;},
  };
}
