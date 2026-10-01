// Authored explanatory hardware; all card/report pixels and grades remain source-bound.
const chapter = document.querySelector('.at-tap');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const texts = [
  ['01 / CHIP + ANTENNA','The connection starts here.','A passive NFC tag holds the link to the card’s saved report. Your phone supplies the power.','ILLUSTRATIVE TAG ASSEMBLY'],
  ['02 / AT THE LABEL','A little closer to the story.','The connection sits at the ATLAS logo. Bring the top of a compatible NFC phone close to the label.','ILLUSTRATIVE SLAB + LABEL'],
  ['03 / TAP + OPEN','One tap. Then open.','Your phone finds the link. Open the notification to see the saved report.','PHONE TAP DEMONSTRATION'],
  ['04 / THE SAVED REPORT','The evidence comes with it.','The grade, original photographs, recorded findings and ATLAS fingerprint—ready to compare with the card in your hand.','ARCHIVED APPROVED SAMPLE']
];
const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => {const t=clamp(value); return t*t*(3-2*t);};
const mix = (a,b,t) => a+(b-a)*t;
const off = () => reduced.matches || document.documentElement.classList.contains('motion-off');
const abort=new AbortController();
let disposed=false;
let sceneApi, readyPromise, active = false, played = false, running = false, frame = 0, start = 0, elapsed = 0, current = 0, target = 0, announced = -1;
const duration = 16000;
const replay = chapter?.querySelector('.at-tap-replay');
function announce(step) {
  if (step === announced) return; announced = step;
  chapter.dataset.step = String(step);
  const copy=texts[step];
  ['.at-tap-kicker','.at-tap-narrative h3','.at-tap-narrative p','.at-tap-object-label'].forEach((selector,index) => chapter.querySelector(selector).textContent=copy[index]);
  chapter.querySelector('.at-tap-stage-index').textContent=`0${step+1} / 04`;
  chapter.querySelectorAll('[data-tap-step]').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.tapStep)===step)));
}
function labelReplay() {replay.innerHTML=running?'Pause the connection <span aria-hidden="true">Ⅱ</span>':'Replay the connection <span aria-hidden="true">↻</span>';}
function draw() {
  sceneApi?.pose(current);
  chapter.style.setProperty('--tap-progress',String(current/3));
  announce(Math.min(3,Math.floor(current+.42)));
}
function cancel() {if(frame)cancelAnimationFrame(frame);frame=0;}
function request() {if(!frame&&active&&!document.hidden&&sceneApi)frame=requestAnimationFrame(tick);}
function timeline(ms) {
  const t=ms/1000;
  if(t<2.7)return 0;
  if(t<5.6)return smooth((t-2.7)/2.9);
  if(t<7.5)return 1;
  if(t<10)return 1+smooth((t-7.5)/2.5);
  if(t<12)return 2;
  if(t<14.3)return 2+smooth((t-12)/2.3);
  return 3;
}
let previous=0;
function tick(now) {
  frame=0;if(!active||document.hidden)return;
  const dt=Math.min(50,now-(previous||now)); previous=now;
  if(running&&!off()) {elapsed=Math.min(duration,now-start);current=timeline(elapsed);target=current;if(elapsed===duration){running=false;labelReplay();}}
  else current=off()?target:mix(current,target,1-Math.exp(-dt/210));
  if(Math.abs(current-target)<.0005)current=target;
  draw();if(running||Math.abs(current-target)>.0005)request();
}
async function choose(step) {
  running=false;played=true;labelReplay();await init();target=step;
  if(off()||!active){current=target;draw();}else request();
}
function pausePolicy() {
  if(off()){running=false;target=Math.round(current);current=target;labelReplay();cancel();draw();}
  if(document.hidden||!active){if(running)elapsed=performance.now()-start;cancel();}
  else {if(running)start=performance.now()-elapsed;previous=0;request();}
}
async function init() {
  return readyPromise ||= import('./nfc-scene.mjs').then(({createNfcScene})=>createNfcScene({chapter,getPose:()=>current,signal:abort.signal,onContextLost:()=>{running=false;cancel();labelReplay();}})).then(api=>{if(disposed){api.dispose();return null;}sceneApi=api;draw();return api;}).catch(error=>{
    if(disposed)return null;
    chapter.dataset.fallback='true';running=false;labelReplay();console.warn('ATLAS tap: source-backed static view retained.',error.message);return null;
  });
}

if(chapter){
  chapter.querySelectorAll('[data-tap-step]').forEach(button=>button.addEventListener('click',()=>choose(Number(button.dataset.tapStep))));
  replay.addEventListener('click',async()=>{await init();if(!sceneApi)return;if(running){running=false;target=current;labelReplay();return;}played=true;if(off()){target=current=3;draw();return;}elapsed=0;current=target=0;running=true;start=performance.now();previous=0;labelReplay();request();});
  const visibility=new IntersectionObserver(async entries=>{active=entries.some(entry=>entry.isIntersecting);if(active){await init();if(!played&&sceneApi){played=true;if(off()){current=target=3;draw();}else {running=true;start=performance.now();elapsed=0;labelReplay();}}}pausePolicy();},{threshold:.18});visibility.observe(chapter.querySelector('.at-tap-visual'));
  const near=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){near.disconnect();init();}},{rootMargin:'350px'});near.observe(chapter);
  document.addEventListener('atlas-motion-change',pausePolicy);document.addEventListener('visibilitychange',pausePolicy);reduced.addEventListener('change',pausePolicy);
  window.addEventListener('pagehide',event=>{if(disposed)return;if(event.persisted){if(running)elapsed=Math.min(duration,performance.now()-start);cancel();return;}disposed=true;abort.abort();cancel();near.disconnect();visibility.disconnect();sceneApi?.dispose();});
  window.addEventListener('pageshow',event=>{if(event.persisted&&!disposed)pausePolicy();});
}
