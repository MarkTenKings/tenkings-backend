// Public aggregate only. Checkout revalidates capacity atomically.
export function capacityView(value, now=Date.now()) {
 if(value?.version==='atlas-weekly-capacity-v2')return sharedCapacityView(value,now);
 if(value?.version!=='atlas-weekly-capacity-v1'||value.unit!=='CARDS'||value.timeZone!=='America/Los_Angeles'||value.resetLocalTime!=='00:01'||!Array.isArray(value.pools)||value.pools.length!==2)return null;
 const asOf=Date.parse(value.asOf),start=Date.parse(value.weekStartsAt),reset=Date.parse(value.resetsAt);
 if(!Number.isFinite(asOf)||!Number.isFinite(start)||!Number.isFinite(reset)||asOf>now+30000||now-asOf>120000||now<start||now>=reset)return null;
 const pools=[];
 for(const channel of ['MAIL_IN','DEALER_DROP_OFF']){
  const matches=value.pools.filter(p=>p?.channel===channel);if(matches.length!==1)return null;const p=matches[0];
  if(p.state==='NOT_CONFIGURED'){pools.push({channel,state:p.state,remaining:null,quota:null});continue;}
  if(!['AVAILABLE','FULL'].includes(p.state)||![p.quotaCards,p.heldCards,p.acceptedCards,p.remainingCards].every(n=>Number.isSafeInteger(n)&&n>=0)||p.remainingCards!==Math.max(0,p.quotaCards-p.heldCards-p.acceptedCards)||(p.state==='FULL')!==(p.remainingCards===0))return null;
  pools.push({channel,state:p.state,remaining:p.remainingCards,quota:p.quotaCards});
 }
 return {pools,reset,asOf};
}
const root=typeof document!=='undefined'?document.querySelector('[data-weekly-capacity]'):null;
if(root){
 const status=root.querySelector('[data-capacity-status]');const activity=root.querySelector('[data-capacity-activity]'),freshness=root.querySelector('[data-capacity-freshness]');let inflight=null,timer=null,visible=false,previous=null;
 const numberAnimations=new Set(),reduced=matchMedia('(prefers-reduced-motion: reduce)');
 const stopAnimations=()=>{for(const animation of numberAnimations)animation.cancel();numberAnimations.clear();};
 const syncAnimationPolicy=()=>{if(!visible||document.hidden||reduced.matches||document.documentElement.classList.contains('motion-off'))stopAnimations();};
 const clear=()=>{previous=null;if(activity)activity.hidden=true;if(freshness)freshness.textContent='CHECK AVAILABILITY';for(const tile of root.querySelectorAll('[data-capacity-channel]')){tile.querySelector('[data-capacity-number]').textContent='—';tile.querySelector('[data-capacity-detail]').textContent='Check availability when you submit';tile.removeAttribute('data-full');tile.style.setProperty('--remaining','0%');}};
 const render=value=>{const view=capacityView(value);if(!view||view.scope!=='SHARED'){clear();status.textContent='Weekly capacity resets Monday at 12:01 a.m. Pacific. Current availability is confirmed in your submission.';return;}
  let fewer=0;
  for(const p of view.pools){const tile=root.querySelector(`[data-capacity-channel="${p.channel}"]`),number=tile.querySelector('[data-capacity-number]'),before=previous?.reset===view.reset&&view.asOf>previous.asOf?previous.pools.find(v=>v.channel===p.channel):null;number.textContent=p.remaining===null?'—':new Intl.NumberFormat('en-US').format(p.remaining);tile.querySelector('[data-capacity-detail]').textContent=p.remaining===null?'Check availability when you submit':p.state==='FULL'?'This week’s capacity is filled':`card ${p.remaining===1?'spot':'spots'} available this week`;tile.toggleAttribute('data-full',p.state==='FULL');tile.style.setProperty('--remaining',`${p.quota?Math.min(100,p.remaining/p.quota*100):0}%`);
   if(before?.quota===p.quota&&Number.isSafeInteger(before?.remaining)&&Number.isSafeInteger(p.remaining)&&p.remaining<before.remaining){fewer+=before.remaining-p.remaining;if(visible&&!document.hidden&&!reduced.matches&&!document.documentElement.classList.contains('motion-off')){const animation=number.animate([{transform:'translateY(-8px)',opacity:.3},{transform:'translateY(0)',opacity:1}],{duration:550,easing:'cubic-bezier(.2,.7,.2,1)'});numberAnimations.add(animation);animation.finished.then(()=>numberAnimations.delete(animation),()=>numberAnimations.delete(animation));}}
  }
  if(freshness)freshness.textContent=view.pools.some(p=>p.remaining!==null)?'UPDATES EVERY MINUTE':'CHECK AVAILABILITY';
  // Aggregate changes observed during this visit; never invented buyers or orders.
  if(activity){activity.hidden=!fewer;if(fewer)activity.textContent=`Availability updated · ${fewer} fewer ${fewer===1?'spot':'spots'} than our last check.`;}
  previous=view;
  const day=new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',month:'short',day:'numeric'}).format(new Date(view.reset));status.textContent=`Current week ends: Monday, ${day}, 12:01 a.m. Pacific. Availability is confirmed at checkout.`;
 };
 async function refresh(){if(inflight||!visible||document.hidden)return;const controller=new AbortController();inflight=controller;const timeout=setTimeout(()=>controller.abort(),8000);try{const response=await fetch('/api/capacity',{cache:'no-store',credentials:'omit',signal:controller.signal,headers:{Accept:'application/json'}});if(!response.ok)throw Error('Unavailable');render(await response.json());}catch{clear();status.textContent='Weekly capacity resets Monday at 12:01 a.m. Pacific. Current availability is confirmed in your submission.';}finally{clearTimeout(timeout);inflight=null;}}
 const sync=()=>{clearInterval(timer);timer=null;syncAnimationPolicy();if(visible&&!document.hidden){refresh();timer=setInterval(refresh,60000);}};
 let observer=null;
 if('IntersectionObserver'in window){observer=new IntersectionObserver(entries=>{visible=entries.some(e=>e.isIntersecting);sync();},{rootMargin:'200px'});observer.observe(root);}else{visible=true;sync();}
 document.addEventListener('visibilitychange',sync);document.addEventListener('atlas-motion-change',syncAnimationPolicy);reduced.addEventListener('change',syncAnimationPolicy);
 const resume=event=>{if(event.persisted)sync();};window.addEventListener('pageshow',resume);
 window.addEventListener('pagehide',event=>{clearInterval(timer);inflight?.abort();stopAnimations();if(!event.persisted){observer?.disconnect();document.removeEventListener('visibilitychange',sync);document.removeEventListener('atlas-motion-change',syncAnimationPolicy);reduced.removeEventListener('change',syncAnimationPolicy);window.removeEventListener('pageshow',resume);}});
}

function sharedCapacityView(value,now){
 if(value.scope!=='SHARED'||value.unit!=='CARDS'||value.timeZone!=='America/Los_Angeles'||value.resetLocalTime!=='00:01'||!Array.isArray(value.pools)||value.pools.length!==2)return null;
 const asOf=Date.parse(value.asOf),start=Date.parse(value.weekStartsAt),reset=Date.parse(value.resetsAt);
 if(!Number.isFinite(asOf)||!Number.isFinite(start)||!Number.isFinite(reset)||asOf>now+30000||now-asOf>120000||now<start||now>=reset)return null;
 const t=value.total,keys=['quotaCards','heldCards','acceptedCards','remainingCards'];if(!t)return null;
 const cold=t.state==='NOT_CONFIGURED';
 if(cold){if(!keys.every(k=>t[k]===null))return null;}
 else if(!keys.every(k=>Number.isSafeInteger(t[k])&&t[k]>=0)||t.heldCards+t.acceptedCards>t.quotaCards||t.remainingCards!==t.quotaCards-t.heldCards-t.acceptedCards||t.state!==(t.remainingCards?'AVAILABLE':'FULL'))return null;
 let held=0,accepted=0;
 for(const channel of ['MAIL_IN','DEALER_DROP_OFF']){const matches=value.pools.filter(p=>p?.channel===channel);if(matches.length!==1)return null;const p=matches[0];if(cold){if(p.heldCards!==null||p.acceptedCards!==null)return null;}else{if(![p.heldCards,p.acceptedCards].every(n=>Number.isSafeInteger(n)&&n>=0))return null;held+=p.heldCards;accepted+=p.acceptedCards;}}
 if(!cold&&(held!==t.heldCards||accepted!==t.acceptedCards))return null;
 return {scope:'SHARED',pools:[{channel:'SHARED',state:t.state,remaining:t.remainingCards,quota:t.quotaCards}],reset,asOf};
}
