import {validateFeatured} from './hero-report-model.mjs';
import {mountReport} from './report-embed.js';
const root=document.documentElement,shell=document.querySelector('#report'),host=shell.querySelector('#atlas-report-embed'),wheel=shell.querySelector('.report-wheel');
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
let entries=[],selected='alakazam',generation=0,spin=0,last=0,frame=null,visible=false,hover=false,focused=false,wheelPaused=false,flights=[],flightPhoto=null;
const motion=()=>!root.classList.contains('motion-off')&&!document.hidden&&!reduced.matches;
const gradeOf=e=>e.demo?9:e.packet.report.finalGrade;
const imageOf=e=>e.demo?e.image.url:e.images.FRONT;
function drawWheel(now=0){
 frame=null;const moving=visible&&!hover&&!focused&&!wheelPaused&&motion();
 if(moving)spin+=(last?Math.min(40,now-last):0)*.000035;last=now;
 const spacing=Math.min(84,(wheel.clientWidth-70)/4),sway=Math.sin(spin)*9;
 [...wheel.children].forEach((b,i)=>{const offset=i-(entries.length-1)/2,x=offset*spacing+sway,y=Math.abs(offset)*6,angle=offset*5;
 b.style.transform=`translate(calc(-50% + ${x}px),${y}px) rotate(${angle}deg)`;});
 if(moving)frame=requestAnimationFrame(drawWheel);
}
function syncWheel(){if(frame)cancelAnimationFrame(frame);frame=null;last=0;drawWheel();}
function renderWheel(){wheel.replaceChildren(...entries.map(e=>{const b=document.createElement('button');b.type='button';b.className='report-thumbnail';b.dataset.reportKey=e.key;b.setAttribute('aria-pressed',String(selected===e.key));b.setAttribute('aria-label',`${e.shortName}, grade ${gradeOf(e)}, ${e.demo?'illustrative demo':'approved report'}`);const g=document.createElement('b');g.textContent=gradeOf(e);const i=document.createElement('img');i.src=imageOf(e);i.alt='';const n=document.createElement('span');n.textContent=e.shortName;b.append(g,i,n);b.addEventListener('click',()=>select(e.key,b));return b;}));syncWheel();}
function stopFlight(){for(const a of flights)a.cancel();flights=[];flightPhoto?.classList.remove('selection-in-flight');flightPhoto=null;shell.classList.remove('report-switching');document.querySelectorAll('.atlas-card-flight').forEach(n=>n.remove());}
async function select(key,button){
 if(button&&selected===key)return;const ticket=++generation,e=entries.find(e=>e.key===key);if(!e)return;
 stopFlight();const source=button?.querySelector('img').getBoundingClientRect(),sourceGrade=button?.querySelector('b').getBoundingClientRect();
 selected=key;root.dataset.heroReport='embedded';shell.classList.add('embedded-report');
 shell.querySelector('.report-topline>span:last-child').textContent=e.demo?'ILLUSTRATIVE DEMO':e.packet.reportNumber;
 shell.setAttribute('aria-label',`${e.shortName} ${e.demo?'illustrative':'approved ATLAS'} report`);
 wheel.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.reportKey===key)));
 const pending=mountReport(host,e);shell.classList.add('report-loading');
 const photo=await pending;if(ticket!==generation)return;shell.classList.remove('report-loading');
 const headline=document.querySelector('#hero-title em'),grade=gradeOf(e);headline.parentElement.firstChild.textContent=`IT’S ${String(grade).startsWith('8')?'AN':'A'} `;headline.textContent=grade+'.';headline.dataset.digits=String(grade).length;
 shell.querySelector('.library-status').textContent=`${e.shortName}, ${e.demo?'illustrative demo':'approved report'}. Grade ${grade}.`;
 document.dispatchEvent(new Event('atlas-report-selected'));document.dispatchEvent(new Event('atlas-guidance-ready'));
 if(!source||!photo||!motion())return;
 const target=photo.getBoundingClientRect(),number=host.querySelector('.rr-overall>strong');
 if(!target.width||target.top<0||target.bottom>innerHeight)return;
 const clone=photo.cloneNode();clone.className='atlas-card-flight';clone.alt='';clone.setAttribute('aria-hidden','true');Object.assign(clone.style,{left:target.left+'px',top:target.top+'px',width:target.width+'px',height:target.height+'px'});document.body.append(clone);
 flightPhoto=photo;photo.classList.add('selection-in-flight');shell.classList.add('report-switching');
 const frames=(from,to)=>[{translate:`${from.left+from.width/2-to.left-to.width/2}px ${from.top+from.height/2-to.top-to.height/2}px`,scale:String(from.width/to.width),opacity:.8},{translate:'0px -3px',scale:'1.008',opacity:1,offset:.87},{translate:'0px 0px',scale:'1',opacity:1}];
 const options={duration:1250,easing:'cubic-bezier(.25,.72,.2,1)',fill:'both'},start=document.timeline.currentTime;
 flights=[clone.animate(frames(source,target),options),headline.animate(frames(sourceGrade,headline.getBoundingClientRect()),options)];if(number)flights.push(number.animate(frames(sourceGrade,number.getBoundingClientRect()),options));for(const a of flights)a.startTime=start;
 const own=flights;Promise.all(own.map(a=>a.finished)).then(()=>{if(flights===own)stopFlight();}).catch(()=>{});
}
wheel.addEventListener('pointerenter',()=>{hover=true;syncWheel();});wheel.addEventListener('pointerleave',()=>{hover=false;syncWheel();});wheel.addEventListener('focusin',()=>{focused=true;syncWheel();});wheel.addEventListener('focusout',()=>{focused=false;syncWheel();});
wheel.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const buttons=[...wheel.children],i=buttons.indexOf(document.activeElement);buttons[(i+(e.key==='ArrowRight'?1:buttons.length-1))%buttons.length].focus();});
shell.querySelector('.wheel-motion').addEventListener('click',e=>{wheelPaused=!wheelPaused;e.currentTarget.textContent=wheelPaused?'▶':'Ⅱ';e.currentTarget.setAttribute('aria-pressed',String(wheelPaused));e.currentTarget.setAttribute('aria-label',wheelPaused?'Play card carousel':'Pause card carousel');syncWheel();});
new IntersectionObserver(es=>{visible=es[0].isIntersecting;syncWheel();}).observe(shell);new ResizeObserver(syncWheel).observe(wheel);
window.addEventListener('scroll',stopFlight,{passive:true});window.addEventListener('resize',stopFlight,{passive:true});
for(const event of ['atlas-motion-change','visibilitychange'])document.addEventListener(event,()=>{if(!motion())stopFlight();syncWheel();});reduced.addEventListener('change',()=>{stopFlight();syncWheel();});
let away=false;new IntersectionObserver(es=>{if(!es[0].isIntersecting)away=true;else if(away){away=false;if(selected!=='alakazam')select('alakazam');}},{threshold:0}).observe(document.querySelector('.evidence-hero'));
try{const [published,demo]=await Promise.all([fetch('/homepage/01945263a443287c/reports/approved.json').then(r=>{if(!r.ok)throw Error();return r.json();}),fetch('/homepage/01945263a443287c/reports/alakazam-demo.json').then(r=>{if(!r.ok)throw Error();return r.json();})]);entries=[demo,...published.reports.map(validateFeatured)];renderWheel();await select('alakazam');}catch(error){host.textContent='The report viewer could not load. Please refresh to try again.';console.error(error);}
