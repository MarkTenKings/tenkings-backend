import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVerifiedImage } from './verified-image.mjs';
import { gradeStoryModel, gradeStoryFrame, GRADE_STORY_DURATION } from './grade-calculation-story.mjs';

const number = (value, digits = 3) => value.toLocaleString('en-US', { maximumFractionDigits: digits });
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Motion explains an approved calculation. It never supplies a grade or approval. */
export function GradeCalculationStory({ explanation, descriptor, expectedHash, name, onCategory, printing = false }) {
  const model = useMemo(() => gradeStoryModel(explanation), [explanation]);
  const image = useVerifiedImage(descriptor?.sha256 === expectedHash ? descriptor : null);
  const panel = useRef(null), raf = useRef(null), clock = useRef({ elapsed: GRADE_STORY_DURATION, last: null });
  const [elapsed, setElapsed] = useState(GRADE_STORY_DURATION), [status, setStatus] = useState('complete'), [category, setCategory] = useState('centering');
  const [sequence, setSequence] = useState(0);
  const cancel = useCallback(() => { if (raf.current !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf.current); raf.current = null; }, []);
  const finish = useCallback(() => { cancel(); clock.current = { elapsed: GRADE_STORY_DURATION, last: null }; setElapsed(GRADE_STORY_DURATION); setStatus('complete'); }, [cancel]);
  const play = useCallback(() => {
    cancel();
    if (reducedMotion() || typeof requestAnimationFrame !== 'function' || printing) { finish(); return; }
    clock.current = { elapsed: 0, last: null }; setElapsed(0); setStatus('playing'); setSequence(value => value + 1);
  }, [cancel, finish, printing]);
  useEffect(() => {
    if (status !== 'playing') return;
    const tick = now => {
      const c = clock.current;
      if (c.last !== null) c.elapsed = Math.min(GRADE_STORY_DURATION, c.elapsed + Math.max(0, now - c.last));
      c.last = now; setElapsed(c.elapsed);
      if (c.elapsed >= GRADE_STORY_DURATION) { raf.current = null; setStatus('complete'); }
      else raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick); return cancel;
  }, [status, sequence, cancel]);
  useEffect(() => {
    finish();
    if (!model || printing || reducedMotion() || typeof IntersectionObserver === 'undefined' || !panel.current) return;
    let started = false;
    const observer = new IntersectionObserver(entries => {
      if (!started && entries.some(entry => entry.isIntersecting && entry.intersectionRatio >= .35)) { started = true; play(); }
    }, { threshold: [0, .35] });
    observer.observe(panel.current); return () => { observer.disconnect(); cancel(); };
  }, [model, printing, play, finish, cancel]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const changed = () => { if (media?.matches) finish(); };
    media?.addEventListener?.('change', changed);
    return () => media?.removeEventListener?.('change', changed);
  }, [finish]);
  if (!model) return null;
  const frame = gradeStoryFrame(model, printing ? GRADE_STORY_DURATION : elapsed);
  const progress = value => 8 + (value - model.minimum) / (model.maximum - model.minimum) * 84;
  const chosen = model.rows.find(row => row.key === category) ?? model.rows[0];
  const pause = () => { if (status === 'playing') { cancel(); setStatus('paused'); } else { clock.current.last = null; setStatus('playing'); } };
  return <section ref={panel} className="rr-grade-story" aria-label="A grade you can follow" data-motion={status} data-raw={frame.raw} data-final={frame.final}>
    <header className="rr-grade-story-head"><div><p className="rr-eyebrow">Measurement → calculation → grade</p><h2>A grade you can follow.</h2><p>Your saved measurements. Your exact grading rule.</p></div>
      {!printing && <div className="rr-grade-story-controls"><button type="button" onClick={play}>{status === 'complete' ? 'Replay calculation' : 'Restart calculation'}</button>
        {status !== 'complete' && <><button type="button" onClick={pause}>{status === 'paused' ? 'Resume calculation' : 'Pause calculation'}</button><button type="button" onClick={finish}>Show result</button></>}</div>}
    </header>
    <div className="rr-grade-story-body"><div className="rr-grade-story-categories"><div className="rr-grade-columns" aria-hidden="true"><span>Category</span><span>Score</span><span>Weight</span><span>Deduct</span></div>
      {model.rows.map((row, index) => <button type="button" key={row.key} className="rr-grade-row" data-visible={frame.rows > index} disabled={frame.rows <= index} aria-pressed={chosen.key === row.key}
        aria-label={`${row.label}: score ${row.score}, ${row.weight * 100}% weight, ${number(row.deduction, 6)} points deducted from overall`}
        onClick={() => { finish(); setCategory(row.key); }}><span>{row.label}</span><data value={row.score}>{number(row.score, 3)}</data><span>{number(row.weight * 100)}%</span><data value={row.deduction}>−{number(row.deduction, 6)}</data></button>)}
      <div className="rr-grade-category-math" data-visible={frame.math}><strong>{chosen.label}</strong>
        <p>Front {number(chosen.front)} × {number(model.frontWeight * 100)}% + Back {number(chosen.back)} × {number(model.backWeight * 100)}% = {number(chosen.score, 6)}</p>
        <p>(10 − {number(chosen.score, 6)}) × {number(chosen.weight * 100)}% = <strong>{number(chosen.deduction, 6)} points</strong> from the overall grade</p>
        {onCategory && <button type="button" disabled={!frame.math} onClick={() => { finish(); onCategory(chosen.key); }}>View {chosen.label.toLowerCase()} measurements</button>}
      </div></div>
      <div className="rr-grade-story-result"><p className="rr-grade-equation" data-visible={frame.math}>10 − <data value={model.deduction}>{number(model.deduction, 6)}</data> = <strong><data value={model.raw}>{number(model.raw, 6)}</data></strong></p>
        <div className="rr-grade-endpoints" data-visible={frame.scale}><div><span>Calculated</span><strong><data value={model.raw}>{number(model.raw, 6)}</data></strong></div><span aria-hidden="true">→</span><div data-visible={frame.final}><span>Final grade</span><strong><data value={model.final}>{number(model.final)}</data></strong></div></div>
        <p className="rr-grade-phase" role="status">{frame.phase}</p>
        <div className="rr-grade-track" data-visible={frame.scale} role="img" aria-label={`Grade scale from ${model.minimum} to ${model.maximum}. Calculated ${model.raw}; final ${model.final}.`}>
          <div className="rr-grade-axis" aria-hidden="true"><span style={{ left: `${progress(model.minimum)}%` }}>{number(model.minimum, 1)}</span><span style={{ left: '50%' }}>{number((model.minimum + model.maximum) / 2, 1)}</span><span style={{ left: `${progress(model.maximum)}%` }}>{number(model.maximum, 1)}</span></div>
          <span className="rr-grade-raw-tick" style={{ left: `${progress(model.raw)}%` }} aria-hidden="true" data-visible={frame.raw}><span>{number(model.raw, 4)}</span></span>
          <div className="rr-grade-traveler" style={{ left: `${progress(frame.position)}%`, transform: `translate(-50%, ${-frame.lift}px)` }} aria-hidden="true">
            <span className="rr-grade-pop" data-visible={frame.raw}>{number(frame.final ? model.final : model.raw, 4)}</span>
            <div className="rr-grade-mini"><div><span>ATLAS</span><b>{frame.raw ? number(frame.final ? model.final : model.raw, 4) : '—'}</b></div>
              {image.url ? <img src={image.url} alt=""/> : <span className="rr-grade-mini-placeholder">{name || 'Card'}</span>}</div>
          </div>
        </div>
        <p className="rr-grade-window" data-visible={frame.scale}>Precision window · {model.minimum}–{model.maximum} / 10</p>
        <p className="rr-grade-policy" data-visible={frame.math}>{model.rounding}</p>
      </div>
    </div>
    <footer>Category deductions sum to the unrounded deduction. Individual finding effects are not additive. All values come from this saved report.</footer>
  </section>;
}
