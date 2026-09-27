import {validateFeatured,categoryDetail,categoryFindings,format,categories} from './hero-report-model.mjs';
const root=document.documentElement,shell=document.querySelector('#report'),wheel=shell.querySelector('.report-wheel');
const bitmap=shell.querySelector('.evidence-bitmap'),photo=bitmap.querySelector('img'),crop=shell.querySelector('.evidence-crop');
const stage=shell.querySelector('.specimen-stage'),zoom=shell.querySelector('.zoom-control'),map=shell.querySelector('.inspection-map');
const summary=shell.querySelector('.report-summary'),finding=shell.querySelector('#finding'),inspector=shell.querySelector('.inspection-explanation');
const demos=new Map();
const remember=(selector)=>{const e=shell.querySelector(selector);demos.set(selector,e.innerHTML);};
['.report-topline','.specimen-caption','.grade-heading','.finding','.math>div','.inspection-explanation','.view-switch','.image-note','.subgrades'].forEach(remember);
// Record leaf content; controls themselves stay mounted so the existing demo keeps its listeners.
let reports=[],active=null,side='FRONT',category='centering',findingIndex=0,magnified=false,generation=0;
let spin=0,last=0,frame=null,visible=false,hover=false,focused=false,wheelPaused=false;
const states=[{key:'alakazam',shortName:'Alakazam',grade:9,image:'/assets/alakazam-reference.jpg',demo:true}];
const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)');
const motion=()=>!root.classList.contains('motion-off')&&!document.hidden&&!reduceMotion.matches;
function setText(selector,text){shell.querySelector(selector).textContent=text;}
function drawWheel(now=0){
 frame=null;const moving=visible&&!hover&&!focused&&!wheelPaused&&motion();
 if(moving)spin+=(last?Math.min(40,now-last):0)*.000032;last=now;
 const width=wheel.clientWidth,radius=Math.min(240,width*.36);
 [...wheel.children].forEach((button,i)=>{const theta=(i-(states.length-1)/2)*.62+Math.sin(spin)*.2,x=radius*Math.sin(theta),y=radius*(1-Math.cos(theta))*.1;
 button.style.transform=`translate(calc(-50% + ${x}px),${y}px) rotate(${theta*9}deg)`;});
 if(moving)frame=requestAnimationFrame(drawWheel);
}
function syncWheel(){if(frame)cancelAnimationFrame(frame);frame=null;last=0;drawWheel();}
function renderWheel(){
 wheel.replaceChildren(...states.map(item=>{const b=document.createElement('button');b.type='button';b.className='report-thumbnail';b.dataset.reportKey=item.key;b.setAttribute('aria-pressed',String((active?.key||'alakazam')===item.key));b.setAttribute('aria-label',`${item.shortName}, grade ${item.grade}${item.demo?', illustrative demo':', approved report'}`);
 const grade=document.createElement('b');grade.textContent=item.grade;const img=document.createElement('img');img.src=item.image;img.alt='';img.width=35;img.height=48;const name=document.createElement('span');name.textContent=item.shortName;b.append(grade,img,name);b.addEventListener('click',()=>requestSelection(item.key,b));return b;}));syncWheel();
}
wheel.addEventListener('pointerenter',()=>{hover=true;syncWheel();});wheel.addEventListener('pointerleave',()=>{hover=false;syncWheel();});
wheel.addEventListener('focusin',()=>{focused=true;syncWheel();});wheel.addEventListener('focusout',()=>{focused=false;syncWheel();});
wheel.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const buttons=[...wheel.children],i=buttons.indexOf(document.activeElement);buttons[(i+(e.key==='ArrowRight'?1:buttons.length-1))%buttons.length].focus();});
shell.querySelector('.wheel-motion').addEventListener('click',e=>{wheelPaused=!wheelPaused;e.currentTarget.textContent=wheelPaused?'▶':'Ⅱ';e.currentTarget.setAttribute('aria-pressed',String(wheelPaused));e.currentTarget.setAttribute('aria-label',wheelPaused?'Play card wheel':'Pause card wheel');syncWheel();});
new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;syncWheel();}).observe(shell);new ResizeObserver(syncWheel).observe(wheel);document.addEventListener('atlas-motion-change',syncWheel);
function camera(){
 if(!active)return;
 const detail=categoryDetail(active,category,side,findingIndex),ratio=photo.naturalWidth/photo.naturalHeight||1350/1858;
 const w=Math.min(crop.clientWidth*.9,crop.clientHeight*.9*ratio);bitmap.style.width=w+'px';bitmap.style.height=w/ratio+'px';
 const scale=magnified&&detail.box?Math.min(9,Math.max(1.15,.55/Math.max(detail.box.w,detail.box.h))):1;
 const x=magnified?(.5-detail.center.x)*w*scale:0,y=magnified?(.5-detail.center.y)*w/ratio*scale:0;
 bitmap.style.transform=`translate(${x}px,${y}px) scale(${scale})`;bitmap.style.setProperty('--inspection-scale',scale);
 crop.querySelector('.camera-readout').textContent=scale>1?`${format(scale)}× DIGITAL ZOOM`:'FULL CARD';
 crop.classList.toggle('zoomed',magnified);zoom.textContent=magnified?'− Full card':'＋ Enlarge region';zoom.setAttribute('aria-pressed',String(magnified));zoom.disabled=!detail.points.length;
 map.hidden=!magnified;const m=map.querySelector('span');if(detail.box){m.style.left=detail.box.x*100+'%';m.style.top=detail.box.y*100+'%';m.style.width=Math.max(2,detail.box.w*100)+'%';m.style.height=Math.max(2,detail.box.h*100)+'%';}
}
function imageSide(){
 const src=active.images[side];photo.src=src;photo.alt=`${active.packet.report.identity.playerName||active.packet.report.identity.cardName}, approved ${side.toLowerCase()} photograph`;map.querySelector('img').src=src;setText('.image-note',`APPROVED PHOTOGRAPH / ${side}`);
 zoom.tabIndex=0;stage.dataset.mode='evidence';shell.querySelector('.evidence-stage').inert=false;shell.querySelector('.evidence-stage').setAttribute('aria-hidden','false');shell.querySelector('.slab-stage').setAttribute('aria-hidden','true');
 shell.querySelectorAll('.view-switch button').forEach((b,i)=>{b.textContent=i?'Back':'Front';b.setAttribute('aria-pressed',String(side===(i?'BACK':'FRONT')));});camera();
}
function showCategory(name,{preferSide=true,zoomIn=true}={}){
 if(!active)return;category=name;findingIndex=0;
 const all=categoryFindings(active,name);
 if(preferSide&&all.length)side=[...all].sort((a,b)=>b.region.measurement.areaMm2-a.region.measurement.areaMm2)[0].finding.side;
 else if(preferSide&&name==='centering')side=active.explanation.sides.BACK.centering.score<active.explanation.sides.FRONT.centering.score?'BACK':'FRONT';
 magnified=zoomIn&&categoryDetail(active,category,side,0).points.length>0;imageSide();renderFinding();
}
function renderFinding(){
 const detail=categoryDetail(active,category,side,findingIndex),r=active.packet.report,g=detail.summary;
 shell.querySelectorAll('.subgrades button').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.category===category));b.querySelector('b').textContent=Number(r.grade.subgrades[b.dataset.category].toFixed(1));b.querySelector('.score-track i').style.setProperty('--score',r.grade.subgrades[b.dataset.category]*10+'%');});
 crop.dataset.category=category;crop.dataset.step='deduction';bitmap.querySelector('.measure-shape').setAttribute('d',detail.path);bitmap.querySelector('.measure-rule').setAttribute('d','');
 setText('.finding-label',`${category.toUpperCase()} / ${side}${detail.list.length?` · ${findingIndex+1} OF ${detail.list.length}`:''}`);
 const title=category==='centering'?'The balance behind the grade.':detail.chosen?detail.chosen.finding.defectType.toLowerCase().replaceAll('_',' ').replace(/^./,s=>s.toUpperCase())+'.':'No included findings.';
 finding.querySelector('h2').textContent=title;
 finding.querySelector('p').textContent=category==='centering'?'Measured border balance on the approved photograph. Front and back both contribute to this category.':detail.chosen?'The saved, reviewed contour shows this region. Select another category or flip the card to keep exploring.':`No ${category} findings were included on the ${side.toLowerCase()}. The score combines both sides.`;
 inspector.dataset.step='deduction';inspector.querySelector('.inspection-invitation').hidden=true;inspector.querySelector('.inspection-facts').hidden=false;
 let value='—',unit='',label='MEASURED AREA';
 if(category==='centering'){label='TOP / BOTTOM BALANCE';value=active.explanation.sides[side].centering.topBottomBalance.map(n=>Number(n.toFixed(1))).join(' : ');}
 else if(detail.chosen){value=format(detail.chosen.region.measurement.areaMm2);unit='mm²';}
 else{label='INCLUDED FINDINGS';value='0';}
 setText('.inspection-metric-label',label);const metric=inspector.querySelector('.inspection-metric');metric.replaceChildren(document.createTextNode(value+' '));const small=document.createElement('small');small.textContent=unit;metric.append(small);
 setText('.inspection-deduction>span','CATEGORY DEDUCTION');setText('.deduction-value','−'+format(g.deductionFromTen));
 const eq=inspector.querySelector('.inspection-equation b');eq.textContent=`10 − ${format(g.deductionFromTen)} = ${format(g.subgrade)}`;
 ['.inspection-measure','.inspection-deduction','.inspection-equation'].forEach(s=>inspector.querySelector(s).setAttribute('aria-hidden','false'));
 setText('.inspection-data-note',`Approved v${active.packet.approvalVersion} · Front ${active.explanation.policy.frontWeight*100}% / Back ${active.explanation.policy.backWeight*100}%`);
 const readout=shell.querySelector('.inspection-readout');readout.querySelector('span').textContent=label;readout.querySelector('strong').textContent=value+' '+unit;
 let nav=finding.querySelector('.finding-pager');if(nav)nav.remove();if(detail.list.length>1){nav=document.createElement('div');nav.className='finding-pager';for(const [label,delta]of[['← Previous',-1],['Next finding →',1]]){const b=document.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',()=>{findingIndex=(findingIndex+delta+detail.list.length)%detail.list.length;renderFinding();});nav.append(b);}finding.append(nav);}
 camera();
}
function restoreDemo(){
 root.dataset.heroReport='demo';active=null;
 for(const [selector,html]of demos){const el=shell.querySelector(selector);if(['.view-switch','.subgrades'].includes(selector))continue;el.innerHTML=html;}
 shell.querySelectorAll('.view-switch button').forEach((b,i)=>b.textContent=i?'The evidence':'The slab');
 const vals=[9,9,8.5,9.5];shell.querySelectorAll('.subgrades button').forEach((b,i)=>{b.querySelector('b').textContent=vals[i];b.querySelector('.score-track i').style.setProperty('--score',vals[i]*10+'%');});
 bitmap.style.width='';bitmap.style.height='';photo.src='/assets/alakazam-reference.jpg';photo.alt='Alakazam reference image — illustrative inspection region, not measured evidence';map.querySelector('img').src=photo.src;zoom.disabled=false;
 shell.querySelector('.view-switch [data-mode="evidence"]').click();shell.querySelector('[data-category="edges"]').click();if(zoom.getAttribute('aria-pressed')==='true')zoom.click();
 shell.setAttribute('aria-label','Interactive Alakazam sample grading report');shell.querySelector('.subgrades').setAttribute('aria-label','Explore sample subgrades');inspector.setAttribute('aria-label','Illustrative measurement and deduction');
}
function selectReport(key){
 const entry=reports.find(r=>r.key===key);
 if(!entry){restoreDemo();}else{
 active=entry;root.dataset.heroReport='approved';side='FRONT';category='centering';magnified=false;
 const r=entry.packet.report,name=r.identity.playerName||r.identity.cardName;
 setText('.report-topline>span:last-child',entry.packet.reportNumber);setText('.specimen-caption strong',name.toUpperCase());setText('.specimen-caption>span',[r.identity.year,r.identity.productSet].filter(Boolean).join(' · '));
 setText('.grade-heading .micro','ATLAS GRADE');setText('.grade-number strong',r.finalGrade);
 const lowest=categories.reduce((a,b)=>r.grade.subgrades[a]<r.grade.subgrades[b]?a:b);
 shell.querySelector('.grade-reason strong').textContent='The grade. The evidence.';shell.querySelector('.grade-reason p').textContent=`Human-approved. ${r.findingCounts.included} recorded findings. Explore the ${lowest}.`;
 shell.setAttribute('aria-label',`${name}, approved ATLAS grade ${r.finalGrade}`);shell.querySelector('.subgrades').setAttribute('aria-label','Explore approved subgrades');inspector.setAttribute('aria-label','Approved measurement and category deduction');imageSide();renderFinding();
 const math=shell.querySelector('.math>div');math.replaceChildren();
 for(const text of [`Four categories. Front ${entry.explanation.policy.frontWeight*100}% / Back ${entry.explanation.policy.backWeight*100}%.`,...categories.map(c=>`${c[0].toUpperCase()+c.slice(1)}: ${format(entry.explanation.categories[c].frontScore)} × ${entry.explanation.policy.frontWeight} + ${format(entry.explanation.categories[c].backScore)} × ${entry.explanation.policy.backWeight} = ${format(r.grade.subgrades[c])}`),`Unrounded overall: ${r.grade.overall.rawGrade}. ATLAS award: ${r.finalGrade}.`,`Report ${entry.packet.reportNumber} · Approved ${entry.packet.approvedAt.slice(0,10)} · v${entry.packet.approvalVersion}`]){const p=document.createElement('p');p.textContent=text;math.append(p);}
 const a=document.createElement('a');a.href=entry.source;a.target='_blank';a.rel='noopener';a.textContent='Open the complete approved report ↗';math.append(a);
 }
 wheel.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.reportKey===key)));
 shell.querySelector('.library-status').textContent=entry?`${entry.shortName} approved report loaded. Grade ${entry.packet.report.finalGrade}.`:'Alakazam illustrative demo loaded.';
 summary.scrollTop=0;shell.querySelector('.math').open=false;
 const grade=entry?.packet.report.finalGrade||9;const em=document.querySelector('#hero-title em');em.parentElement.firstChild.textContent=`IT’S ${String(grade).startsWith('8')?'AN':'A'} `;em.textContent=grade+'.';em.dataset.digits=String(grade).length;
 document.dispatchEvent(new Event('atlas-report-selected'));
}
let flights=[],flightPhoto=null;
function stopFlight(){shell.classList.remove('report-switching');for(const a of flights)a.cancel();flights=[];flightPhoto?.classList.remove('selection-in-flight');flightPhoto=null;document.querySelectorAll('.atlas-card-flight').forEach(e=>e.remove());}
async function requestSelection(key,button){
 if(key===(active?.key||'alakazam'))return;
 const ticket=++generation,item=states.find(s=>s.key===key),loaded=new Image();loaded.src=item.image;
 try{await loaded.decode();}catch{if(ticket===generation)shell.querySelector('.library-status').textContent='That photograph could not load. Please try again.';return;}
 if(ticket!==generation)return;
 stopFlight();const source=button.querySelector('img').getBoundingClientRect(),sourceGrade=button.querySelector('b').getBoundingClientRect();
 // Snap the underlying camera before measuring the destination, even after a close-up.
 shell.classList.add('report-switching');
 selectReport(key);
 photo.getBoundingClientRect();
 if(!motion()){stopFlight();return;}
 // The card, headline number and report number share exactly one launch and landing.
 const target=photo.getBoundingClientRect(),headline=document.querySelector('#hero-title em'),number=shell.querySelector('.grade-number strong');
 const clone=photo.cloneNode();clone.className='atlas-card-flight';clone.alt='';clone.setAttribute('aria-hidden','true');
 Object.assign(clone.style,{left:target.left+'px',top:target.top+'px',width:target.width+'px',height:target.height+'px'});document.body.append(clone);
 flightPhoto=photo;photo.classList.add('selection-in-flight');
 const origin=(from,to)=>`${from.left+from.width/2-to.left-to.width/2}px ${from.top+from.height/2-to.top-to.height/2}px`;
 const options={duration:820,easing:'cubic-bezier(.16,.76,.21,1)',fill:'both'};
 const frames=(from,to)=>[{translate:origin(from,to),scale:String(from.width/to.width),opacity:.75,offset:0},{translate:'0px -8px',scale:'1.025',opacity:1,offset:.82},{translate:'0px 0px',scale:'1',opacity:1,offset:1}];
 const start=document.timeline.currentTime;
 flights=[clone.animate(frames(source,target),options),headline.animate(frames(sourceGrade,headline.getBoundingClientRect()),options),number.animate(frames(sourceGrade,number.getBoundingClientRect()),options)];
 for(const a of flights)a.startTime=start;
 const own=flights;Promise.all(own.map(a=>a.finished)).then(()=>{if(flights===own)stopFlight();}).catch(()=>{});
}
window.addEventListener('scroll',stopFlight,{passive:true});window.addEventListener('resize',stopFlight,{passive:true});document.addEventListener('atlas-motion-change',()=>{if(!motion())stopFlight();});reduceMotion.addEventListener('change',()=>{if(!motion())stopFlight();syncWheel();});document.addEventListener('visibilitychange',()=>{if(document.hidden)stopFlight();syncWheel();});
shell.addEventListener('click',e=>{if(!active)return;const b=e.target.closest('button');if(!b)return;
 if(b.matches('.subgrades button')){e.stopImmediatePropagation();showCategory(b.dataset.category);}
 else if(b.matches('.view-switch button')){e.stopImmediatePropagation();side=b.dataset.mode==='slab'?'FRONT':'BACK';showCategory(category,{preferSide:false,zoomIn:false});}
 else if(b===zoom||b===map){e.stopImmediatePropagation();magnified=b===map?false:!magnified;camera();}
},true);
photo.addEventListener('load',camera);document.addEventListener('atlas-hero-resize',camera);new ResizeObserver(camera).observe(crop);
renderWheel();
try{
 const response=await fetch('/reports-data/approved.json');if(!response.ok)throw Error('Report library unavailable');
 reports=(await response.json()).reports.map(validateFeatured);
 reports.forEach(e=>states.push({key:e.key,shortName:e.shortName,grade:e.packet.report.finalGrade,image:e.images.FRONT}));renderWheel();
}catch(error){shell.querySelector('.library-status').textContent='Additional reports could not load. The Alakazam demo remains available.';console.warn(error.message);}

let heroWasAway=false;new IntersectionObserver(es=>{if(!es[0].isIntersecting)heroWasAway=true;else if(heroWasAway){heroWasAway=false;generation++;stopFlight();if(active)selectReport('alakazam');}},{threshold:0}).observe(document.querySelector('.evidence-hero'));
