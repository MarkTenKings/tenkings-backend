import test from 'node:test';
import assert from 'node:assert/strict';
import {createTourSound} from '../src/evidence-tour-sound.mjs';
test('paired scan sound requires a gesture and only beeps on a playing inspection entry, never scrub or repeat frames',async()=>{
  let listener,created=0,tones=0,closed=0;
  const controller={subscribe(fn){listener=fn;fn({progress:0,playing:false});return()=>{listener=null;};}};
  const plan={sample:(_plan,p)=>({kind:p>=.5&&p<.8?'inspect':'travel',key:'saved-defect-stop'})};
  const context={state:'running',currentTime:2,destination:{},createOscillator(){return{frequency:{setValueAtTime(){}},connect(){},start(){tones++;},stop(){},disconnect(){}};},createGain(){return{gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};},async close(){closed++;}};
  const sound=createTourSound({controller,plan,createContext:()=>{created++;return context;}});
  listener({progress:.6,playing:true});assert.equal(created,0);assert.equal(tones,0);
  assert.equal(await sound.setEnabled(true),true);assert.equal(created,1);
  listener({progress:.7,playing:true});assert.equal(tones,0,'enabling midway through a hold does not replay its signal');
  listener({progress:.4,playing:false});listener({progress:.6,playing:false});listener({progress:.65,playing:true});assert.equal(tones,0,'scrub then resume does not beep');
  listener({progress:.4,playing:true});listener({progress:.6,playing:true});listener({progress:.7,playing:true});assert.equal(tones,1);
  await sound.setEnabled(false);listener({progress:.4,playing:true});listener({progress:.6,playing:true});assert.equal(tones,1);
  sound.dispose();assert.equal(listener,null);assert.equal(closed,1);assert.equal(await sound.setEnabled(true),false);
});
