// Shared visual guidance. Never activates a control or changes report evidence.
const controllers=new Map();
function attach(root){
 let timer=null,index=0,visible=false,restUntil=0,current=null;
 const reduce=matchMedia('(prefers-reduced-motion: reduce)'),off=[];
 const listen=(el,event,fn)=>{el.addEventListener(event,fn);off.push(()=>el.removeEventListener(event,fn));};
 const clear=()=>{clearTimeout(timer);timer=null;current?.classList.remove('atlas-heartbeat');current=null;};
 const targets=()=>[...root.querySelectorAll(root.id==='report'?'.subgrades button,.zoom-control,.math summary':'.rr-score-strip button,.rr-finding-list button,.rr-image-tools button,summary')].filter(el=>!el.disabled&&el.getClientRects().length&&!el.closest('[aria-hidden="true"]')&&el.getBoundingClientRect().bottom>0&&el.getBoundingClientRect().top<innerHeight);
 function schedule(){clear();if(!visible||document.hidden||reduce.matches||document.documentElement.classList.contains('motion-off')||root.closest('[data-guidance-paused="true"]'))return;
 timer=setTimeout(()=>{if(Date.now()<restUntil||root.contains(document.activeElement)){schedule();return;}const items=targets();if(items.length){current=items[index++%items.length];current.classList.add('atlas-heartbeat');}timer=setTimeout(schedule,1500);},3000);}
 const interact=()=>{restUntil=Date.now()+10000;schedule();};
 listen(root,'pointerdown',interact);listen(root,'keydown',interact);listen(root,'focusin',clear);listen(root,'focusout',schedule);
 const observer=new IntersectionObserver(es=>{visible=es[0].isIntersecting;schedule();});observer.observe(root);
 for(const event of ['visibilitychange','atlas-motion-change','atlas-report-selected','atlas-guidance-ready'])listen(document,event,schedule);
 listen(reduce,'change',schedule);
 return()=>{clear();observer.disconnect();off.forEach(fn=>fn());};
}
function refresh(){
 for(const [root,dispose]of controllers)if(!root.isConnected){dispose();controllers.delete(root);}
 for(const root of document.querySelectorAll('#report,.rr-report'))if(!controllers.has(root))controllers.set(root,attach(root));
}
document.addEventListener('atlas-guidance-ready',refresh);refresh();
