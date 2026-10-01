// Public aggregate only. Checkout revalidates capacity atomically.
export function capacityView(value, now=Date.now()) {
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
 const status=root.querySelector('[data-capacity-status]');let inflight=null,timer=null,visible=false;
 const clear=()=>{for(const tile of root.querySelectorAll('[data-capacity-channel]')){tile.querySelector('[data-capacity-number]').textContent='—';tile.querySelector('[data-capacity-detail]').textContent='Check availability when you submit';tile.removeAttribute('data-full');}};
 const render=value=>{const view=capacityView(value);if(!view){clear();status.textContent='Weekly capacity resets Monday at 12:01 a.m. Pacific. Current availability is confirmed in your submission.';return;}
  for(const p of view.pools){const tile=root.querySelector(`[data-capacity-channel="${p.channel}"]`);tile.querySelector('[data-capacity-number]').textContent=p.remaining===null?'—':new Intl.NumberFormat('en-US').format(p.remaining);tile.querySelector('[data-capacity-detail]').textContent=p.remaining===null?'Weekly availability opens soon':p.state==='FULL'?'This week’s capacity is filled':`card ${p.remaining===1?'spot':'spots'} available this week`;tile.toggleAttribute('data-full',p.state==='FULL');}
  const day=new Intl.DateTimeFormat('en-US',{timeZone:'America/Los_Angeles',month:'short',day:'numeric'}).format(new Date(view.reset));status.textContent=`Next weekly release: Monday, ${day}, 12:01 a.m. Pacific. Availability is confirmed at checkout.`;
 };
 async function refresh(){if(inflight||!visible||document.hidden)return;const controller=new AbortController();inflight=controller;const timeout=setTimeout(()=>controller.abort(),8000);try{const response=await fetch('/api/capacity',{cache:'no-store',credentials:'omit',signal:controller.signal,headers:{Accept:'application/json'}});if(!response.ok)throw Error('Unavailable');render(await response.json());}catch{clear();status.textContent='Weekly capacity resets Monday at 12:01 a.m. Pacific. Current availability is confirmed in your submission.';}finally{clearTimeout(timeout);inflight=null;}}
 const sync=()=>{clearInterval(timer);timer=null;if(visible&&!document.hidden){refresh();timer=setInterval(refresh,60000);}};
 if('IntersectionObserver'in window)new IntersectionObserver(entries=>{visible=entries.some(e=>e.isIntersecting);sync();},{rootMargin:'200px'}).observe(root);else{visible=true;sync();}
 document.addEventListener('visibilitychange',sync);window.addEventListener('pagehide',()=>{clearInterval(timer);inflight?.abort();});
}
