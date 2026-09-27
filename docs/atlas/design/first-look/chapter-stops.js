// One deliberate desktop wheel gesture per story beat. Keyboard, touch and reduced motion stay native.
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
let gestureUntil=0,settlingUntil=0;
const chapters=[{element:document.querySelector('#beyond'),scene:'.cinema-scene',beats:[0,.29,.49,.69]},
 {element:document.querySelector('#fingerprint'),scene:'.fingerprint-scene',beats:[0,.255,.505]}];
window.addEventListener('wheel',event=>{
 if(event.ctrlKey||event.shiftKey||Math.abs(event.deltaX)>Math.abs(event.deltaY)||Math.abs(event.deltaY)<2||innerWidth<=700||reduced.matches||document.documentElement.classList.contains('motion-off'))return;
 if(event.target.closest('input,select,textarea,dialog,[open],.rr-viewport,.atlas-report-embed'))return;
 const now=performance.now();
 if(now<gestureUntil||now<settlingUntil){gestureUntil=now+240;event.preventDefault();return;}
 const direction=Math.sign(event.deltaY);
 for(const c of chapters){const rect=c.element.getBoundingClientRect(),scene=c.element.querySelector(c.scene),travel=c.element.offsetHeight-scene.offsetHeight;
  if(travel<=0||rect.top>2||rect.bottom<=scene.offsetHeight-2)continue;
  const top=scrollY+rect.top,at=-rect.top,points=c.beats.map(p=>p*travel);
  const next=direction>0?points.find(p=>p>at+8):[...points].reverse().find(p=>p<at-8);
  if(next===undefined)return;
  event.preventDefault();gestureUntil=now+240;settlingUntil=now+850;
  window.scrollTo({top:top+next,behavior:'smooth'});return;
 }
},{passive:false});
