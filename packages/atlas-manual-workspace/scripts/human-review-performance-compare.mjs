/** Compare only the reproducible controlled fixture runs, never production SLOs. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const [beforePath, afterPath, output] = process.argv.slice(2);
assert([beforePath,afterPath,output].every(path=>path?.startsWith('/')),'Three absolute paths required');
const [beforeBytes,afterBytes]=await Promise.all([beforePath,afterPath].map(path=>readFile(path)));
const [before,after]=[beforeBytes,afterBytes].map(bytes=>JSON.parse(bytes));
assert(before.pass&&after.pass);assert.deepEqual(before.profiles,after.profiles);assert.equal(before.trials,after.trials);
const byRun=run=>`${run.profile}/${run.cache}/${run.trial}`;
const bySummary=row=>`${row.profile}/${row.cache}/${row.name}`;
const oldRuns=new Map(before.results.map(run=>[byRun(run),run]));
const unchanged=[];
for(const run of after.results){
  const old=oldRuns.get(byRun(run));assert(old);
  assert.equal(run.finalReportHash,old.finalReportHash,'Report content is byte-identical');
  assert.deepEqual(run.imageBytes,old.imageBytes,'Synthetic image bytes retain the same sizes');
  for(const current of run.measurements){
    const prior=old.measurements.find(row=>row.name===current.name);assert(prior);
    assert.equal(current.findingsHash,prior.findingsHash,`${current.name}: identical saved findings`);
    assert.equal(current.geometryHash,prior.geometryHash,`${current.name}: identical geometry`);
    assert.equal(current.revision,prior.revision,`${current.name}: same revision`);
    assert.deepEqual(current.actions,prior.actions,`${current.name}: same explicit action-type sequence`);
  }
  unchanged.push(byRun(run));
}
assert.equal(unchanged.length,before.results.length);
const oldSummaries=new Map(before.summary.map(row=>[bySummary(row),row]));
const comparisons=after.summary.map(row=>{
  const prior=oldSummaries.get(bySummary(row));assert(prior);
  const unique=values=>[...new Set(values)].sort((a,b)=>a-b);
  const expected={ 'open-review':[2,1], 'next-card':[2,1], 'save-finding-type':[2,0], 'approve-front-findings':[1,0], 'approve-back-findings':[2,0] }[row.name];
  if(expected){assert.deepEqual(unique(prior.workspaceReads),[expected[0]],`${row.name}: baseline workspace reads`);assert.deepEqual(unique(row.workspaceReads),[expected[1]],`${row.name}: removed redundant workspace reads`);}
  return {profile:row.profile,cache:row.cache,step:row.name,trials:row.trials,
    beforeMedianMs:prior.medianMs,afterMedianMs:row.medianMs,medianReductionMs:prior.medianMs-row.medianMs,
    beforeMaxMs:prior.maxMs,afterMaxMs:row.maxMs,
    beforeRequests:unique(prior.requestCounts),afterRequests:unique(row.requestCounts),
    beforeWorkspaceReads:unique(prior.workspaceReads),afterWorkspaceReads:unique(row.workspaceReads)};
});
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const statistics=values=>{const sorted=values.toSorted((a,b)=>a-b);return{medianMs:sorted.length%2?sorted[(sorted.length-1)/2]:(sorted[sorted.length/2-1]+sorted[sorted.length/2])/2,maxMs:sorted.at(-1)};};
const phaseSummary=(data,row)=>{
  const measurements=data.results.filter(run=>run.profile===row.profile&&run.cache===row.cache).map(run=>run.measurements.find(measurement=>measurement.name===row.step));
  const profile=data.profiles.find(value=>value.name===row.profile);
  const tasks={
    serverSaveAndCommitMs:m=>m.serverRequests.flatMap(r=>r.phases).filter(p=>p.name==='save-and-commit').reduce((sum,p)=>sum+p.durationMs,0),
    postCommitLearningMemoryMs:m=>m.serverRequests.flatMap(r=>r.phases).filter(p=>p.name==='post-commit-learning-memory').reduce((sum,p)=>sum+p.durationMs,0),
    workspaceCardReadMs:m=>m.serverRequests.flatMap(r=>r.phases).filter(p=>p.name==='workspace-card-read').reduce((sum,p)=>sum+p.durationMs,0),
    workspaceHydrationMs:m=>m.serverRequests.flatMap(r=>r.phases).filter(p=>p.name==='workspace-hydration').reduce((sum,p)=>sum+p.durationMs,0),
    latestPhotoRevisionFenceMs:m=>m.serverRequests.flatMap(r=>r.phases).filter(p=>p.name==='latest-photo-revision-fence').reduce((sum,p)=>sum+p.durationMs,0),
    previewGenerationMs:m=>m.serverRequests.flatMap(r=>r.phases).filter(p=>p.name==='preview-generation').reduce((sum,p)=>sum+p.durationMs,0),
    nativeMeasurementAndSchedulingBeyondInjectedCommitMs:m=>m.serverRequests.filter(r=>r.actionType==='MEASURE_SIDE').flatMap(r=>r.phases).filter(p=>p.name==='save-and-commit').reduce((sum,p)=>sum+Math.max(0,p.durationMs-profile.commitMs),0),
    imageTransferTaskMs:m=>m.resources.filter(r=>r.name.startsWith('/images/')).reduce((sum,r)=>sum+r.durationMs,0),
    imageHashTaskMs:m=>m.digests.reduce((sum,r)=>sum+r.end-r.start,0),
    imageDecodeTaskMs:m=>m.decodes.reduce((sum,r)=>sum+r.end-r.start,0),
    imageGradientPreparationTaskMs:m=>m.preparation.reduce((sum,r)=>sum+r.end-r.start,0),
  };
  return Object.fromEntries(Object.entries(tasks).map(([name,collect])=>[name,statistics(measurements.map(collect))]));
};
const phases=comparisons.map(row=>({profile:row.profile,cache:row.cache,step:row.step,before:phaseSummary(before,row),after:phaseSummary(after,row)}));
const result={pass:true,scope:'Controlled synthetic fixture timing only. Actual desktop Chrome and phone viewport/bandwidth simulation, not production or physical-phone measurements. Median and observed maximum over exactly the stated trials, not a p95 claim.',before:{path:beforePath,sha256:digest(beforeBytes),sourceCommit:before.sourceCommit,sourceFiles:before.sourceFiles},after:{path:afterPath,sha256:digest(afterBytes),sourceCommit:after.sourceCommit,sourceFiles:after.sourceFiles},profiles:before.profiles,unchangedEvidence:{runs:unchanged.length,checks:['identical report-content hash','identical saved findings hash at every step','identical saved geometry hash at every step','same revisions and explicit action-type sequence','correct exact image hash and usable controls required by both browser runs']},comparisons,phaseCaveat:'Phase values are medians/maxima of summed task durations within each click interval, not an additive critical-path decomposition: some tasks overlap and prefetch can move image work before the click. Server delays are declared fixture inputs. Native measurement beyond injected 80ms commit delay includes actual CPU adapter work and host scheduling, not isolated CPU cycles.',phases};
result.sampleSelection=after.sampleSelection??null;
result.hostNoiseEvidence=after.hostNoiseEvidence??null;
await writeFile(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({pass:true,unchangedRuns:unchanged.length,comparisonRows:comparisons.length,output},null,2));
