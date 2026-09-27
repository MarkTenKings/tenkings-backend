// One session belongs to one reviewer and one open rapid-review flow. It survives
// card changes, but is discarded when that flow closes. No lifetime counters.
const STAGES = ['geometry', 'findings', 'report', 'completion'];
const draw = (random, size) => Math.min(size - 1, Math.max(0, Math.floor(random() * size)));
export const ATLAS_LINES = [
  {
    "file": "wise.mp3",
    "mood": "Wise",
    "text": "The eye notices a mark. Experience knows when to look again."
  },
  {
    "file": "reassuring.mp3",
    "mood": "Reassuring",
    "text": "Take another look, my friend. The heavens can wait."
  },
  {
    "file": "playful.mp3",
    "mood": "Playful",
    "text": "An entire legend in the palm of your hand. Very efficient."
  },
  {
    "file": "celebratory.mp3",
    "mood": "Celebratory",
    "text": "Carefully seen. Fairly judged. Fine work, my friend.",
    "completionOnly": true
  },
  {
    "file": "serious.mp3",
    "mood": "Serious",
    "text": "Famous name or not, every card deserves the same care."
  },
  {
    "file": "grand.mp3",
    "mood": "Grand",
    "text": "I've watched mountains rise, yet a careful pair of hands still impresses me."
  },
  {
    "file": "teasing.mp3",
    "mood": "Playfully teasing",
    "text": "Shall I bring that corner a chair for its interview, my friend?"
  },
  {file:"playful-door.mp3", mood:"Playful", text:"They expect thunder, so naturally, I use the door."},
  {file:"teasing-crown.mp3", mood:"Playfully teasing", text:"With eyes like yours around, I'd better polish the back of my crown."}
];
export function createReviewSession(staffId, random = Math.random) {
  return {staffId, random, count:0, approvals:new Set(), nextAt:5+draw(random,6), stage:STAGES[draw(random,STAGES.length)], remaining:[], lastLine:null};
}
export function claimReviewVoice(session, {staffId, stage, completed=false, enabled=true}) {
  if (!session || session.staffId !== staffId || !enabled) return null;
  const ordinal=session.count+(completed?0:1);
  // The completion fallback covers a skipped/adjusted stage without adding a
  // second appearance. Thus 100 completed cards produce 10–20 appearances.
  if (ordinal<session.nextAt || stage!==session.stage && stage!=='completion') return null;
  const eligible=index=>!ATLAS_LINES[index].completionOnly || stage==='completion';
  if (!session.remaining.some(eligible)) session.remaining=ATLAS_LINES.map((_,i)=>i);
  const candidates=session.remaining.filter(index=>eligible(index)&&index!==session.lastLine);
  const pool=candidates.length?candidates:session.remaining.filter(eligible);
  const voiceIndex=pool[draw(session.random,pool.length)];
  session.remaining=session.remaining.filter(index=>index!==voiceIndex);session.lastLine=voiceIndex;
  session.nextAt=ordinal+5+draw(session.random,6);session.stage=STAGES[draw(session.random,STAGES.length)];
  return {count:session.count, ordinal, voiceIndex};
}
export function recordReviewCompletion(session, staffId, actionId, enabled=true) {
  if (!session || session.staffId!==staffId || !actionId || session.approvals.has(actionId)) return null;
  session.approvals.add(actionId);session.count++;
  return claimReviewVoice(session,{staffId,stage:'completion',completed:true,enabled}) ?? {count:session.count,voiceIndex:null};
}
let context, voice, voiceTimer;
export function reviewSoundEnabled() {
  try { return localStorage.getItem('atlas-review-sound') !== 'off'; } catch { return true; }
}
export function setReviewSound(enabled) {
  try { localStorage.setItem('atlas-review-sound', enabled ? 'on' : 'off'); } catch {}
  if (!enabled) { clearTimeout(voiceTimer); voice?.pause(); void context?.suspend().catch(()=>{}); }
}
export function primeReviewAudio() {
  if (typeof window === 'undefined' || !reviewSoundEnabled()) return;
  try { const AudioContext = window.AudioContext || window.webkitAudioContext; if (AudioContext) { context ??= new AudioContext(); void context.resume().catch(()=>{}); } } catch {}
}
export function playReviewCompletion(result, basePath) {
  if (!result || !reviewSoundEnabled()) return;
  try {
    if (context?.state === 'running') {
      [659.25, 987.77, 1318.51].forEach((frequency, i) => {
        const oscillator=context.createOscillator(), gain=context.createGain(), start=context.currentTime+i*.075;
        oscillator.type='sine'; oscillator.frequency.value=frequency;
        gain.gain.setValueAtTime(0,start); gain.gain.linearRampToValueAtTime(.065,start+.012); gain.gain.exponentialRampToValueAtTime(.001,start+.32);
        oscillator.connect(gain); gain.connect(context.destination); oscillator.start(start); oscillator.stop(start+.34);
      });
    }
    if (result.voiceIndex !== null) playAtlasVoice(result,basePath,550);
  } catch { /* Audio is optional and never blocks the next card. */ }
}
export function stopReviewVoice() { clearTimeout(voiceTimer); voice?.pause(); }

export function playAtlasVoice(result, basePath, delay=0) {
  if (result?.voiceIndex===null || result?.voiceIndex===undefined || !reviewSoundEnabled()) return;
  clearTimeout(voiceTimer);voice?.pause();
  voiceTimer=setTimeout(()=>{if (!reviewSoundEnabled()) return; try {voice=new Audio(`${basePath}/audio/atlas/${ATLAS_LINES[result.voiceIndex].file}`);voice.volume=.75;void voice.play().catch(()=>{});} catch {}},delay);
}
