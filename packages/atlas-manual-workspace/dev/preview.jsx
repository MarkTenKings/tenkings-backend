import React, { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PairedGeometryWorkspace } from '../src/PairedGeometryWorkspace';
import { applyGeometryEdit, applyPreparedFrame, confirmBothGeometry, createGeometryWorkspace, geometryBase, parseGeometryWorkspace, preparationBase } from '../src/geometry-actions.mjs';
import '../src/workspace.css';
import { adoptGeometryPreparation } from '../src/preparation-result.mjs';

const fixture = await fetch('/fixture.json').then(response => response.json());
const sides = ['FRONT', 'BACK'];
const image = side => { const frame = fixture[side].frames.original, source = fixture[side].photoSource; return { version: 1, originalSha256: source.original.content.sha256, frameId: source.frame.id, frameSha256: frame.sha256, width: frame.width, height: frame.height, coordinateSpace: 'ORIENTED_DECODED' }; };
const initial = () => {
  let state = createGeometryWorkspace({ cardId: 'synthetic-component-fixture', profile: 'SPORTS', sides: Object.fromEntries(sides.map(side => [side, { image: image(side), cornerShape: 'SQUARE', matColor: 'BLACK' }])) });
  for (const side of sides) {
    const { physical, printed, frames, matrix } = fixture[side];
    const descriptor = kind => ({ sha256: frames[kind].sha256, width: frames[kind].width, height: frames[kind].height });
    state = applyGeometryEdit(state, { side, kind: 'PHYSICAL', base: geometryBase(state, side, 'PHYSICAL'), quad: physical, actor: 'HUMAN', proposal: null }).state;
    state = applyPreparedFrame(state, { side, base: preparationBase(state, side), frame: { id: `${side}-synthetic-prepared`, version: state.sides[side].preparationRevision + 1, rectified: descriptor('rectified'), inspection: { ...descriptor('inspection'), cardBounds: { x: 40, y: 40, width: 1270, height: 1778 } }, sourceToRectified: matrix } }).state;
    state = applyGeometryEdit(state, { side, kind: 'PRINTED', base: geometryBase(state, side, 'PRINTED'), quad: printed, actor: 'HUMAN', proposal: null }).state;
  }
  return state;
};
// Deliberately isolated sample storage; this is not the production persistence adapter.
const storageKey = `atlas-synthetic-geometry:${fixture.FRONT.frames.original.sha256}`;
function App() {
  const [workspace, setWorkspace] = useState(() => { try { const saved = localStorage.getItem(storageKey); return saved ? parseGeometryWorkspace(saved) : initial(); } catch { return initial(); } });
  const current = useRef(workspace), failNext = useRef(false);
  const [fault, setFault] = useState('none');
  const [preparing, setPreparing] = useState({}), [preparationError, setPreparationError] = useState('');
  const pending = useRef({});
  current.current = workspace;
  const save = next => { localStorage.setItem(storageKey, JSON.stringify(next)); const saved = parseGeometryWorkspace(localStorage.getItem(storageKey)); current.current = saved; setWorkspace(saved); };
  const prepareSide = async (side, snapshot = current.current) => {
    pending.current[side]?.abort();
    const controller = new AbortController(); pending.current[side] = controller;
    setPreparing(previous => ({ ...previous, [side]: true })); setPreparationError('');
    try {
      const response = await fetch('/prepare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ side, workspace: snapshot }), signal: controller.signal });
      if (!response.ok) throw new Error('Preparation failed');
      const result = await response.json();
      save(adoptGeometryPreparation(current.current, result).state);
    } finally {
      if (pending.current[side] === controller) { delete pending.current[side]; setPreparing(previous => ({ ...previous, [side]: false })); }
    }
  };
  // Development-only test hooks. This entry is excluded from the package export/build.
  window.fixtureControl = {
    state: () => structuredClone(current.current),
    reset: () => { setFault('none'); save(initial()); },
    failSave: () => { failNext.current = true; },
    imageFault: setFault,
    reprepareSameBytes: side => {
      const state = current.current, previous = state.sides[side], quad = previous.printed.quad;
      let next = applyPreparedFrame(state, { side, base: preparationBase(state, side), frame: { ...previous.prepared.frame, version: previous.preparationRevision + 1 } }).state;
      next = applyGeometryEdit(next, { side, kind: 'PRINTED', base: geometryBase(next, side, 'PRINTED'), quad, actor: 'HUMAN', proposal: null }).state;
      save(next);
    },
    externalEdit: side => { const state = current.current, quad = state.sides[side].printed.quad.map(p => ({ ...p, x: p.x + .001 })); save(applyGeometryEdit(state, { side, kind: 'PRINTED', base: geometryBase(state, side, 'PRINTED'), quad, actor: 'HUMAN', proposal: null }).state); },
  };
  const images = Object.fromEntries(sides.map(side => {
    const hash = workspace.sides[side].prepared?.frame.rectified.sha256;
    return [side, { original: { ...fixture[side].frames.original }, rectified: hash && hash !== fixture[side].frames.rectified.sha256
      ? { url: `/${hash}.webp`, sha256: hash } : { ...fixture[side].frames.rectified } }];
  }));
  if (fault === 'missing') delete images.FRONT;
  if (fault === 'hash') images.FRONT.original.sha256 = '0'.repeat(64);
  if (fault === 'load') images.FRONT.original.url = '/unavailable.png';
  if (fault === 'dimensions') images.FRONT.original.url = fixture.FRONT.frames.rectified.url;
  return <><aside style={{ font: '14px system-ui', padding: 16 }}>Synthetic component test. Saves stay in this browser; physical edits use the actual CPU preparation engine. <button onClick={() => { window.fixtureControl.reset(); window.location.reload(); }}>Reset sample</button></aside>
    {preparationError && <p role="alert">{preparationError}</p>}
    <PairedGeometryWorkspace workspace={workspace} images={images} preparingSides={preparing} onPrepare={prepareSide} saveStatus="Sample saved in this browser"
      onEdit={async action => { if (failNext.current) { failNext.current = false; throw new Error('simulated save failure'); } const next = applyGeometryEdit(current.current, action).state; save(next);
        if (action.kind === 'PHYSICAL' && new URLSearchParams(location.search).get('autoPrepare') !== '0') void prepareSide(action.side, next).catch(error => { if (error.name !== 'AbortError' && error.code !== 'ATLAS_GEOMETRY_STALE') setPreparationError('Preparation needs retry. The saved physical edge is retained.'); }); }}
      onConfirm={async action => save(confirmBothGeometry(current.current, action).state)} /></>;
}
createRoot(document.getElementById('root')).render(<App />);
