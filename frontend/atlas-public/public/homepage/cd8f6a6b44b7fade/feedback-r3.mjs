// One downward arrival, a brief pause, then acceleration into each service.
const bridge=document.querySelector('.route-bridge-r3');
const release=document.querySelector('.weekly-release');
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
let visible=false,animations=[];
function stop(){for(const a of animations)a.cancel();animations=[];}
function sync(){
  stop();const paused=reduced.matches||document.hidden||document.documentElement.classList.contains('motion-off');
  if(release)release.dataset.motion=paused?'paused':'playing';
  if(!bridge||!visible||paused)return;
  for(const [i,card]of [...bridge.querySelectorAll('.flow-card')].entries())animations.push(card.animate([
    {left:'50%',top:'-50px',opacity:0,transform:'translateX(-50%) scale(.8)',offset:0},
    {left:'50%',top:'18%',opacity:1,transform:'translateX(-50%) scale(1)',offset:.18},
    {left:'50%',top:'25%',opacity:1,transform:'translateX(-50%) scale(1)',offset:.43},
    {left:i===0?'24.5%':'75.5%',top:'108%',opacity:1,transform:'translateX(-50%) scale(.8)',offset:.66},
    {left:i===0?'24.5%':'75.5%',top:'118%',opacity:0,transform:'translateX(-50%) scale(.8)',offset:1}
  ],{duration:i===0?4600:6000,delay:i*2300,easing:'linear',iterations:Infinity}));
}
const observer=new IntersectionObserver(entries=>{for(const entry of entries){if(entry.target===bridge)visible=entry.isIntersecting;else entry.target.dataset.visible=String(entry.isIntersecting);}sync();},{threshold:.04});
if(bridge)observer.observe(bridge);if(release)observer.observe(release);
document.addEventListener('atlas-motion-change',sync);document.addEventListener('visibilitychange',sync);reduced.addEventListener('change',sync);
window.addEventListener('pagehide',e=>{if(e.persisted)return;stop();observer.disconnect();document.removeEventListener('atlas-motion-change',sync);document.removeEventListener('visibilitychange',sync);reduced.removeEventListener('change',sync);});
sync();
