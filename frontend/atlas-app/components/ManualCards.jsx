import React,{useCallback,useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/router';
import Shell from './Shell';
import {createIntakeClient,createBrowserIntakeJournal} from '@atlas/manual-intake/client';
import {createManualClient} from '@atlas/manual-workflow/client';
import {PairedGeometryWorkspace} from '@atlas/manual-workspace';
import {DefectReviewWorkspace} from '@atlas/manual-workspace/defects';
import {geometryStatus} from '@atlas/manual-workspace/geometry-actions';
import {manualRequest,manualMessage} from '../lib/manual-client.mjs';
import {STAFF_BASE_PATH} from '../lib/routes.mjs';
import {createDefectAnalysisClient} from '../lib/manual-defect-analysis-client.mjs';

const labels={name:'Name',category:'Printed category',manufacturer:'Manufacturer',card_number:'Card number',year:'Year',set_name:'Product / set',variant:'Printed variant',card_type:'Printed card type'};
const prefix='/api/staff/manual-connected/cards';
export default function ManualCards({staff,cardId=null}){
  const router=useRouter(),client=useRef(null),session=useRef(null),auto=useRef(new Set()),generation=useRef(0);
  const [cards,setCards]=useState([]),[saved,setSaved]=useState(null),[pending,setPending]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(''),[screen,setScreen]=useState('intake');
  const [identifying,setIdentifying]=useState(false),[changes,setChanges]=useState({}),[localReady,setLocalReady]=useState(false);
  const [commandPending,setCommandPending]=useState(null);
  const [nextCursor,setNextCursor]=useState(null);
  const commandKey=`atlas-connected-command:${staff.id}:${cardId??'new'}`;
  const dirty=Object.keys(changes).length>0;
  const request=(path,options={})=>manualRequest(path,{...options,csrf:session.current?.csrf});
  async function refresh(){
    const started=generation.current;
    if(cardId){const value=await request(`${prefix}/${cardId}`);if(started===generation.current)setSaved(value);return value;}
    const result=await client.current.list();if(started===generation.current){setCards(result.cards??[]);setNextCursor(result.nextCursor??null);}
  }
  async function pendingList(){const started=generation.current,result=await client.current.pending();if(started===generation.current)setPending(result);}
  async function attempt(work,label='Saving…'){
    const started=generation.current;
    setError('');setBusy(label);try{return await work();}catch(error){if(started===generation.current)setError(manualMessage(error));throw error;}
    finally{if(started===generation.current){setBusy('');if(client.current)await pendingList().catch(()=>{});}}
  }
  function perform(work,label){void attempt(work,label).catch(()=>{});}
  useEffect(()=>{
    const started=++generation.current;let stopped=false,journal,ownedClient;
    (async()=>{
      const currentSession=await request('/api/staff/session');
      if(stopped)return;
      if(!currentSession.staff)throw {code:'SIGN_IN_REQUIRED'};
      if(currentSession.staff.id!==staff.id)throw {code:'MANUAL_STAFF_CHANGED'};
      session.current=currentSession;
      journal=createBrowserIntakeJournal({staffId:staff.id});
      ownedClient=createIntakeClient({request:(path,options)=>manualRequest(path,{...options,csrf:currentSession.csrf}),journal});client.current=ownedClient;
      setCommandPending(JSON.parse(localStorage.getItem(commandKey)??'null'));setLocalReady(true);await pendingList();if(stopped)return;const result=await refresh();
      if(!stopped&&result?.manual?.current)setScreen('workspace');
    })().catch(error=>{if(!stopped)setError(manualMessage(error));});
    return()=>{stopped=true;if(generation.current===started)generation.current++;if(client.current===ownedClient)client.current=null;void journal?.close();};
  },[cardId,staff.id]);
  useEffect(()=>{
    if(!saved?.card.ready || saved.manual || saved.identification.state!=='NOT_STARTED' || auto.current.has(saved.card.sourceHash))return;
    const started=generation.current;auto.current.add(saved.card.sourceHash);setIdentifying(true);
    request(`${prefix}/${cardId}/identify`,{method:'POST',body:{}}).then(()=>{if(started===generation.current)return refresh();}).catch(error=>{if(started===generation.current)setError(manualMessage(error));}).finally(()=>{if(started===generation.current)setIdentifying(false);});
  },[saved?.card.sourceHash,saved?.identification.state,saved?.manual]);
  useEffect(()=>{
    if(!dirty)return;const warn=event=>{event.preventDefault();event.returnValue='';};
    const block=()=>{if(!window.confirm('Discard the unsaved card details?')){router.events.emit('routeChangeError');throw 'Unsaved card details';}};
    window.addEventListener('beforeunload',warn);router.events.on('routeChangeStart',block);
    return()=>{window.removeEventListener('beforeunload',warn);router.events.off('routeChangeStart',block);};
  },[dirty,router]);
  async function durable(path,body){
    if(localStorage.getItem(commandKey))throw {code:'MANUAL_PENDING_REQUEST'};
    const command={path,body};localStorage.setItem(commandKey,JSON.stringify(command));setCommandPending(command);
    return sendSaved(command);
  }
  async function sendSaved(input){
    const serialized=JSON.stringify(input),command=JSON.parse(serialized),started=generation.current;
    const updatePending=()=>{if(started===generation.current)setCommandPending(JSON.parse(localStorage.getItem(commandKey)??'null'));};
    if(localStorage.getItem(commandKey)!==serialized){updatePending();throw {code:'MANUAL_PENDING_REQUEST'};}
    const clear=()=>{
      // Another tab may already have finished this command and started a new
      // uncertain save. An older reply must never erase its recovery identity.
      if(localStorage.getItem(commandKey)===serialized)localStorage.removeItem(commandKey);
      updatePending();
    };
    try{const result=await request(command.path,{method:'POST',body:command.body});clear();return result;}
    catch(error){if([400,403,404,409,413,422].includes(error.status)){clear();await refresh();}throw error;}
  }
  async function saveDetails(){
    if(!dirty)return saved;
    await durable(`${prefix}/${cardId}/details`,{actionId:crypto.randomUUID(),expectedRevision:saved.revision,changes});
    setChanges({});return refresh();
  }
  async function initialize(){
    const value=await saveDetails();
    await durable(`${prefix}/${cardId}/initialize`,{sourceHash:value.card.sourceHash,detailsRevision:value.revision});
    await refresh();setScreen('workspace');
  }
  async function replace(){
    await durable(`/api/staff/manual/cards/${cardId}/actions`,{actionId:crypto.randomUUID(),expectedRevision:saved.manual.revision,action:{type:'REPLACE_SOURCES',sourceHash:saved.card.sourceHash}});
    await refresh();setScreen('workspace');
  }
  const profile=Object.hasOwn(changes,'profile')?changes.profile:saved?.details.profile;
  const layoutType=Object.hasOwn(changes,'layoutType')?changes.layoutType:saved?.details.layoutType;
  const activePending=pending.filter(item=>!cardId || item.value.cardId===cardId);
  return <Shell staff={staff} title="Manual grading" manual><div className="mc-page">
    {error&&<div className="mc-notice error" role="alert">{error} <button onClick={()=>perform(()=>refresh(),'Loading saved card…')}>Reload saved state</button></div>}
    {busy&&<p role="status">{busy}</p>}
    {commandPending&&!busy&&<section className="mc-notice"><p>A saved request needs confirmation. Resume it before making another change.</p><button onClick={()=>perform(async()=>{await sendSaved(commandPending);const result=await refresh();if(result?.manual?.current)setScreen('workspace');},'Checking the saved request…')}>Resume saved request</button></section>}
    {activePending.length>0&&<section className="mc-notice"><h2>Saved uploads</h2>{activePending.map(item=><div key={item.id}><span>{item.value.kind==='create'?'New card':`${item.value.input.side==='FRONT'?'Front':'Back'} photo`} · {item.value.verified?'Original saved; working image needs preparation':'Upload saved on this device'}</span><button disabled={Boolean(busy)} onClick={()=>perform(async()=>{const result=await client.current.resume(item.id);if(!cardId&&result.card)await router.push(`/manual/${result.card.cardId}`);else await refresh();},'Resuming saved upload…')}>Resume</button>
      {item.value.verified&&<button disabled={Boolean(busy)} onClick={()=>perform(()=>client.current.forgetVerified(item.id),'Keeping the verified original…')}>Clear device copy</button>}
      {!item.value.uploadId&&item.value.planRefusal&&item.value.planUncertain===false&&<button disabled={Boolean(busy)} onClick={()=>perform(()=>client.current.discardUnplanned(item.id),'Clearing the refused upload…')}>Discard refused upload</button>}
    </div>)}</section>}
    {!cardId?<>
      <header className="mc-heading"><div><p className="mc-kicker">ATLAS / MANUAL GRADING</p><h1>Your cards</h1><p>Upload original Front and Back photos, review the geometry, then inspect the findings.</p></div>
        {staff.role==='REVIEWER'&&<button className="primary" disabled={!localReady||Boolean(busy)} onClick={()=>perform(async()=>{const result=await client.current.create();await router.push(`/manual/${result.card.cardId}`);},'Saving a new card…')}>+ Add card</button>}</header>
      <div className="mc-card-list">{cards.map(card=><Link href={`/manual/${card.cardId}`} key={card.cardId}><strong>{card.label||'Untitled card'}</strong><span>{card.sides.FRONT.upload?.source?'Front ready':'Front needed'} · {card.sides.BACK.upload?.source?'Back ready':'Back needed'}</span><small>{new Date(card.createdAt).toLocaleString()}</small></Link>)}{localReady&&!cards.length&&<p>No cards yet. Add a card to upload the original photos.</p>}</div>
      {nextCursor&&<div className="mc-actions"><button disabled={Boolean(busy)} onClick={()=>perform(async()=>{const result=await client.current.list({cursor:nextCursor});setCards(old=>[...old,...result.cards.filter(card=>!old.some(value=>value.cardId===card.cardId))]);setNextCursor(result.nextCursor);},'Loading older cards…')}>Load more cards</button></div>}
    </>:!saved?<p role="status">Loading saved card…</p>:screen==='workspace'&&saved.manual?.current?<ManualWorkspace key={`${staff.id}:${cardId}`} staff={staff} cardId={cardId} csrf={session.current.csrf} onPhotos={()=>{setScreen('intake');perform(()=>refresh(),'Loading saved photos…');}}/>:<>
      <header className="mc-heading"><div><Link href="/manual">← All cards</Link><h1>{saved.card.label||'New card'}</h1><p>Select the original files from your iPhone photo library. The originals stay untouched.</p></div>{saved.manual?.current&&<button className="primary" onClick={()=>setScreen('workspace')}>Return to review</button>}</header>
      <section className="mc-photo-pair">{['FRONT','BACK'].map(side=>{const slot=saved.card.sides[side];return <article key={side}><h2>{side==='FRONT'?'Front':'Back'}</h2>
        {slot.upload?.source?<img key={slot.version} alt={`${side==='FRONT'?'Front':'Back'} SDR working view`} src={saved.previews?.[side]?.url??`${STAFF_BASE_PATH}${prefix}/${cardId}/preview-image/${side}`} />:<div className="mc-photo-empty">{slot.upload?.verification?'Original saved. Resume image preparation.':'Original photo needed'}</div>}
        <label className="mc-upload">{slot.upload?'Replace original photo':'Choose original photo'}<input aria-label={`${side} original photo`} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.HEIC,.heif,.HEIF" disabled={!localReady||Boolean(busy)||Boolean(commandPending)||dirty||staff.role!=='REVIEWER'} onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)perform(async()=>{await client.current.upload(cardId,side,slot.version,file);await refresh();},`Saving ${side==='FRONT'?'Front':'Back'} original…`);}}/></label>
        <p>{slot.upload?.source?'Original retained · full-resolution SDR working view':slot.upload?.verification?'Original verified and retained':'Choose one side of this card'}</p></article>;})}</section>
      {saved.manual?<section className="mc-notice"><p>{saved.manual.current?'Your geometry and findings are saved.':'A photo changed. Review the new side before confirming the pair again; the other side’s work is retained.'}</p>
        {!saved.manual.current&&<button className="primary" disabled={!saved.card.ready||Boolean(busy)} onClick={()=>perform(replace,'Preparing the changed photo…')}>Use replaced photo pair</button>}</section>:
      <section className="mc-details"><div className="mc-heading"><div><h2>Card details</h2><p>{identifying?'Reading the Front and Back photos…':saved.identification.state==='COMPLETE'?'Suggestions are ready. Check the details printed on your card.':['UNKNOWN','FAILED','UNAVAILABLE'].includes(saved.identification.state)?'Automatic details are unavailable. Enter the printed details to continue.':'Add both photos for automatic identification.'}</p></div>{['RUNNING','NOT_STARTED'].includes(saved.identification.state)&&saved.card.ready&&!identifying&&<button onClick={()=>perform(async()=>{await request(`${prefix}/${cardId}/identify`,{method:'POST',body:{}});await refresh();},'Checking identification…')}>Check saved identification</button>}</div>
        <form onSubmit={event=>{event.preventDefault();perform(initialize,'Preparing the review workspace…');}}><fieldset disabled={Boolean(busy)||Boolean(commandPending)} style={{border:0,padding:0,margin:0}}>
          <div className="mc-fields"><label>Card family<select aria-label="Card family" value={profile??''} onChange={event=>setChanges(old=>({...old,profile:event.target.value||null}))}><option value="">Choose Sports or Pokémon</option><option value="SPORTS">Sports</option><option value="POKEMON">Pokémon</option></select></label>
            {Object.entries(labels).map(([key,label])=><label key={key}>{label}<input aria-label={label} value={changes[key]??saved.details.fields[key]} maxLength={key==='year'?24:160} onChange={event=>setChanges(old=>({...old,[key]:event.target.value}))}/></label>)}
            {profile==='POKEMON'&&<label>Pokémon layout<select aria-label="Pokémon layout" value={layoutType??''} onChange={event=>setChanges(old=>({...old,layoutType:event.target.value||null}))}><option value="">Choose from the card</option><option value="POKEMON">Pokémon</option><option value="TRAINER">Trainer</option><option value="ENERGY">Energy</option></select></label>}
            <label>Parallel for report<input value={changes.parallel??saved.details.parallel} maxLength={120} onChange={event=>setChanges(old=>({...old,parallel:event.target.value}))}/><small>Confirm the printed variant here if it is the card’s parallel.</small></label>
            <label>Insert for report<input value={changes.insert??saved.details.insert} maxLength={120} onChange={event=>setChanges(old=>({...old,insert:event.target.value}))}/></label>
            <label>Corner shape<select value={changes.cornerShape??saved.details.cornerShape} onChange={event=>setChanges(old=>({...old,cornerShape:event.target.value}))}><option value="ROUNDED_3_18_MM">Rounded</option><option value="SQUARE">Square</option></select></label>
            <label>Background mat<select value={changes.matColor??saved.details.matColor} onChange={event=>setChanges(old=>({...old,matColor:event.target.value}))}><option value="BLACK">Black</option><option value="WHITE">White</option><option value="MAGENTA">Magenta</option></select></label>
          </div><div className="mc-actions"><button type="button" disabled={!dirty||Boolean(busy)} onClick={()=>perform(saveDetails,'Saving card details…')}>Save details</button><button className="primary" disabled={!saved.card.ready||Boolean(busy)||identifying}>Review geometry →</button></div>
        </fieldset></form>
      </section>}
    </>}
  </div></Shell>;
}

export function ManualWorkspace({staff,cardId,csrf,onPhotos}){
  const [view,setView]=useState(null),[screen,setScreen]=useState('geometry'),[error,setError]=useState(''),[status,setStatus]=useState(''),[report,setReport]=useState(null),[editing,setEditing]=useState(false),[preparing,setPreparing]=useState({}),[approving,setApproving]=useState(false),[identity,setIdentity]=useState(null),[refreshingImages,setRefreshingImages]=useState(false);
  const client=useRef(null),analysisClient=useRef(null),imageRefresh=useRef(null),viewRef=useRef(null),interaction=useRef({}),router=useRouter();
  interaction.current={...interaction.current,identity:Boolean(identity),approving,saving:status==='Saving…'};
  const changeEditing=useCallback(value=>{interaction.current.editing=value;setEditing(value);},[]);
  const attempt=async work=>{const owner=client.current;setError('');try{return await work();}catch(error){if(client.current===owner)setError(manualMessage(error));}};
  useEffect(()=>{
    let stopped=false;
    const ownedClient=createManualClient({cardId,staffId:staff.id,csrf,storage:localStorage,basePath:STAFF_BASE_PATH,timeoutMs:210000,
      onView:value=>{if(!stopped){const updated=withLocalAnalysis(value);viewRef.current=updated;setView(updated);}},onStatus:value=>{if(!stopped)setStatus(value);}});
    client.current=ownedClient;
    const ownedAnalysis=createDefectAnalysisClient({cardId,staffId:staff.id,storage:localStorage,
      request:(path,options={})=>manualRequest(path,{...options,csrf}),onAnalysis:astra=>{
        if(stopped||client.current!==ownedClient||!viewRef.current)return;
        const updated={...viewRef.current,astra};viewRef.current=updated;setView(updated);
      }});
    analysisClient.current=ownedAnalysis;
    void ownedClient.recover().then(async value=>{if(stopped)return;setScreen(geometryStatus(value.geometry).confirmed?'defects':'geometry');
      if(value.astra?.enabled)await ownedAnalysis.refresh();
    }).catch(error=>{if(!stopped)setError(manualMessage(error));});
    const timer=setInterval(()=>{if(!ownedClient.hasPending())void attempt(refreshImages);},240000);
    return()=>{stopped=true;clearInterval(timer);ownedAnalysis.dispose();if(analysisClient.current===ownedAnalysis)analysisClient.current=null;if(client.current===ownedClient)client.current=null;};
  },[cardId,staff.id,csrf]);
  function withLocalAnalysis(value){
    const owned=analysisClient.current;
    try{
      const known=owned?.current();if(!known)return value;
      // A grant/view read may have begun before the analysis acknowledgement.
      // Keep that known run, while accepting fresh review decisions for it.
      const lagging=value.astra?.analysisId!==known.analysisId
        || (['READY','REFUSED','FAILED','STALE'].includes(known.status)&&['IDLE','RUNNING','UNKNOWN'].includes(value.astra?.status));
      return owned.hasPending()||lagging?{...value,astra:known}:value;
    }
    catch{return value;}
  }
  async function refreshImages(){
    if(imageRefresh.current)return imageRefresh.current;
    const owner=client.current;if(!owner||owner.hasPending())return;
    setRefreshingImages(true);
    const work=(async()=>{
      const requested=viewRef.current;
      const fresh=await manualRequest(`/api/staff/manual/cards/${cardId}/view`,{csrf});
      if(client.current!==owner)return;
      const current=viewRef.current;
      if(!current||fresh.card.revision!==current.card.revision||fresh.card.contentHash!==current.card.contentHash)throw {code:'MANUAL_REVISION_CONFLICT'};
      // Renew access to these exact pixels without replacing an unsaved edit or the client's command base.
      const renewed=withLocalAnalysis({...current,images:fresh.images,astra:fresh.astra,
        reviewedMemory:current.reviewedMemory!==requested?.reviewedMemory?current.reviewedMemory:fresh.reviewedMemory});viewRef.current=renewed;setView(renewed);
    })();imageRefresh.current=work;
    try{await work;}finally{if(imageRefresh.current===work)imageRefresh.current=null;if(client.current===owner)setRefreshingImages(false);}
  }
  async function switchStage(next){
    const owner=client.current;await refreshImages();const active=interaction.current;
    if(client.current===owner&&!active.editing&&!active.identity&&!active.approving&&!active.saving&&!owner.hasPending()){setReport(null);setScreen(next);}
  }
  async function refreshAssistance(owner){
    const requested=viewRef.current;
    const fresh=await manualRequest(`/api/staff/manual/cards/${cardId}/view`,{csrf});
    if(client.current!==owner)return;
    const current=viewRef.current;
    if(!current||fresh.card.revision!==current.card.revision||fresh.card.contentHash!==current.card.contentHash)return;
    // Analysis and memory are separate saved records. Only refresh their
    // projections and image grants; a delayed read cannot replace human edits.
    const updated=withLocalAnalysis({...current,astra:fresh.astra,
      reviewedMemory:current.reviewedMemory!==requested?.reviewedMemory?current.reviewedMemory:fresh.reviewedMemory,images:fresh.images});viewRef.current=updated;setView(updated);
  }
  async function analyze(mode,input){
    const owner=client.current,coordinator=analysisClient.current;
    if(!owner||!coordinator)throw {code:'MANUAL_ANALYSIS_UNAVAILABLE'};
    const result=await coordinator[mode](input);
    if(client.current===owner)await refreshAssistance(owner).catch(error=>{if(client.current===owner)setError(manualMessage(error));});
    return result;
  }
  async function retryMemory(){
    const owner=client.current,current=viewRef.current;
    const result=await manualRequest(`${prefix}/${cardId}/defect-memory`,{method:'POST',body:{},csrf});
    if(client.current!==owner)return result;
    const latest=viewRef.current;
    if(latest&&current&&latest.card.revision===current.card.revision&&latest.card.contentHash===current.card.contentHash&&result.reviewedMemory){
      const updated={...latest,reviewedMemory:result.reviewedMemory};viewRef.current=updated;setView(updated);
    }
    await refreshAssistance(owner).catch(error=>{if(client.current===owner)setError(manualMessage(error));});return result;
  }
  useEffect(()=>{if(!editing&&!identity)return;const warn=event=>{event.preventDefault();event.returnValue='';};const block=()=>{router.events.emit('routeChangeError');throw 'Save or discard the current edit before leaving';};window.addEventListener('beforeunload',warn);router.events.on('routeChangeStart',block);return()=>{window.removeEventListener('beforeunload',warn);router.events.off('routeChangeStart',block);};},[editing,identity,router]);
  const execute=action=>client.current.execute(action);
  async function prepare(side){setPreparing(old=>({...old,[side]:true}));try{await execute({type:'PREPARE_SIDE',side});}finally{setPreparing(old=>({...old,[side]:false}));}}
  const savePending=status==='Saving…'||Boolean(client.current?.hasPending());
  const locked=editing||Boolean(identity)||approving||savePending;
  if(!view)return <div>{error&&<p role="alert">{error}</p>}<p role="status">Loading saved review…</p><button onClick={()=>attempt(()=>client.current.recover())}>Retry</button></div>;
  return <>
    {error&&<div className="mc-notice error" role="alert">{error}</div>}
    <nav className="mc-review-nav"><button disabled={locked||refreshingImages} onClick={onPhotos}>Photos</button><button disabled={locked||refreshingImages||screen==='geometry'} onClick={()=>attempt(()=>switchStage('geometry'))}>Geometry</button><button disabled={locked||refreshingImages||screen==='defects'||!geometryStatus(view.geometry).confirmed} onClick={()=>attempt(()=>switchStage('defects'))}>Findings</button><button disabled={locked} onClick={()=>setIdentity({...view.identity})}>Edit card details</button><button disabled={savePending||refreshingImages} onClick={()=>attempt(refreshImages)}>{refreshingImages?'Loading images…':'Reload images'}</button><span>{status||'Saved'}</span>{client.current.hasPending()&&<button onClick={()=>attempt(()=>client.current.recover())}>Retry pending save</button>}</nav>
    {identity?<section className="mc-details"><h1>Correct card details</h1><form onSubmit={event=>{event.preventDefault();if(savePending)return;void attempt(async()=>{await execute({type:'IDENTITY_EDIT',identity});setIdentity(null);setReport(null);setScreen('geometry');});}}><fieldset disabled={savePending} style={{border:0,padding:0,margin:0}}><div className="mc-fields">{Object.entries(identity).map(([key,value])=><label key={key}>{({playerName:'Player name',cardName:'Card name',productSet:'Product / set',cardNumber:'Card number',layoutType:'Pokémon layout'})[key]??key}{key==='layoutType'?<select value={value} onChange={event=>setIdentity(old=>({...old,[key]:event.target.value}))}>{['POKEMON','TRAINER','ENERGY'].map(layout=><option key={layout}>{layout}</option>)}</select>:<input value={value??''} onChange={event=>setIdentity(old=>({...old,[key]:event.target.value}))}/>}</label>)}</div><div className="mc-actions"><button className="primary">Save card details</button><button type="button" onClick={()=>setIdentity(null)}>Discard changes</button></div></fieldset></form></section>:
    screen==='geometry'?<PairedGeometryWorkspace workspace={view.geometry} images={view.images} onEditingChange={changeEditing} saveStatus={status||'Saved'} preparingSides={preparing} onPrepare={prepare}
      onEdit={async input=>{const {actor,proposal,...edit}=input;await execute({type:'GEOMETRY_EDIT',edit});if(input.kind==='PHYSICAL')void attempt(()=>prepare(input.side));}}
      onConfirm={async({base,reviewed})=>{await execute({type:'CONFIRM_GEOMETRY',base,reviewed});setScreen('defects');}}/>:
    screen==='defects'&&view.defects?<DefectReviewWorkspace workspace={view.defects} images={view.images} onEditingChange={changeEditing} saveStatus={status||'Saved'}
      astra={view.astra} reviewedMemory={view.reviewedMemory} onAnalyzeDefects={input=>analyze('start',input)} onRefreshAnalysis={()=>analyze('refresh')}
      onResumeAnalysis={()=>analyze('resume')} onRetryReviewedMemory={retryMemory}
      onReviewProposal={async input=>{const owner=client.current;await owner.reviewProposal(input);if(client.current===owner&&input.action!=='REJECT')void attempt(()=>owner.execute({type:'MEASURE_SIDE',side:input.side}));}}
      onEdit={async input=>{await client.current.editDefect(input);void attempt(()=>execute({type:'MEASURE_SIDE',side:input.side}));}}
      onRetry={side=>execute({type:'MEASURE_SIDE',side})} onDiscardPending={({side,base})=>execute({type:'DISCARD_PENDING',side,base})}
      onInspect={({side,base,inspected})=>execute({type:'INSPECT_SIDE',side,base,inspected})} onConfirm={({base,reviewed})=>execute({type:'CONFIRM_FINDINGS',base,reviewed})}
      onContinue={()=>attempt(async()=>{setReport(await client.current.previewReport());setScreen('report');})}/>:
    report&&<section className="mc-report"><p className="mc-kicker">ATLAS / FINAL HUMAN REVIEW</p><h1>Review draft report</h1><p>{Object.values(report.report.identity).filter(value=>typeof value==='string'&&value).join(' · ')}</p><strong className="mc-grade">{report.report.grade.overall.displayGrade}</strong><table><thead><tr><th>Condition</th><th>Front</th><th>Back</th><th>Subgrade</th></tr></thead><tbody>{['centering','corners','edges','surface'].map(name=><tr key={name}><th>{name}</th><td>{report.report.grade.front[name].score}</td><td>{report.report.grade.back[name].score}</td><td>{report.report.grade.subgrades[name]}</td></tr>)}</tbody></table><p>Front contributes 70%; Back contributes 30%.</p><p>{report.report.findingCounts.included} included findings · {report.report.findingCounts.removed} removed</p>
      {view.approval?.sourceHash===view.card.contentHash&&view.approval.reportHash===report.reportHash?<div className="mc-notice" role="status">Report approved and saved.</div>:<><p>Review the corrected identity, findings and grades before approving this exact report.</p>{view.approval&&<p>An earlier approved report is retained in history. This draft needs its own approval.</p>}<button className="primary" disabled={approving||savePending} onClick={()=>attempt(async()=>{setApproving(true);try{await execute({type:'APPROVE_REPORT',reportHash:report.reportHash,reviewed:true});}finally{setApproving(false);}})}>{approving?'Approving…':'Approve final report'}</button></>}
    </section>}
  </>;
}
