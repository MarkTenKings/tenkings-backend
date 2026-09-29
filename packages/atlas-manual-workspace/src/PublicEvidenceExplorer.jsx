import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReportInspectionImage } from './ReportInspectionImage.jsx';
import { reportSpatialNavigation } from './report-spatial-navigation.mjs';

const SIDES = ['FRONT', 'BACK'];
const NO_LAYERS = { physical: false, printed: false, centering: false };
const CENTERING_LAYERS = { physical: true, printed: true, centering: true };
const PRINT_LAYERS = { physical: true, printed: true, centering: false };
const title = value => String(value ?? '').toLowerCase().replaceAll('_', ' ').replace(/^./, letter => letter.toUpperCase());
const number = value => Number.isFinite(value)
  ? Math.abs(value) > 0 && Math.abs(value) < .0001 ? value.toExponential(2)
    : value.toLocaleString('en-US', { maximumFractionDigits: 4 }) : 'Unavailable';
const ratio = values => Array.isArray(values) && values.length === 2 && values.every(Number.isFinite)
  ? `${number(values[0])}% / ${number(values[1])}%` : 'Unavailable';

/** Customer navigation only. Both hash-bound viewers remain mounted, including
 * the hidden side, so browsing cannot replace or manufacture image readiness. */
export function PublicEvidenceExplorer({ report, explanation, images, geometry, selected, activeSide,
  onSelect, onClear, onChooseSide, onReady, sideReady, findingDetails, printing = false }) {
  const navigation = useMemo(() => reportSpatialNavigation(report.findings), [report.findings]);
  const sideFindings = useMemo(() => Object.fromEntries(SIDES.map(side => [side,
    report.findings.filter(finding => finding.side === side)])), [report.findings]);
  const [section, setSection] = useState(selected?.id ? 'finding' : 'whole');
  const findingNavigator = useRef(null);
  useEffect(() => {
    if (section === 'finding' && typeof window !== 'undefined') {
      findingNavigator.current?.scrollIntoView?.({block:'start',behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
    }
  }, [section]);
  const [lastFinding, setLastFinding] = useState({ FRONT: null, BACK: null });
  const [overlays, setOverlays] = useState(true);
  const [fingerprintCommand, setFingerprintCommand] = useState(null);
  const returnFromFingerprint = useCallback(() => setSection('whole'), []);
  const tide = type => setFingerprintCommand(old => ({ type, sequence: (old?.sequence ?? 0) + 1 }));
  const [command, setCommand] = useState(null), [zooms, setZooms] = useState({ FRONT: 1, BACK: 1 });
  const current = navigation.entries.find(entry => entry.id === selected?.id);
  const entries = navigation.entries.filter(entry => entry.finding.side === activeSide);
  const otherSide = activeSide === 'FRONT' ? 'BACK' : 'FRONT';
  const otherEntries = navigation.entries.filter(entry => entry.finding.side === otherSide);
  const position = navigation.entries.findIndex(entry => entry.id === selected?.id);
  const ready = sideReady(activeSide), zoom = zooms[activeSide];
  const centering = explanation?.sides?.[activeSide]?.centering;
  const shown = section === 'finding' ? current : null;
  const remember = useCallback(entry => {
    const side = entry.finding.side;
    setLastFinding(old => old[side] === entry.id ? old : { ...old, [side]: entry.id });
  }, []);
  useEffect(() => {
    if (!current) return;
    setSection('finding'); remember(current);
  }, [current, selected?.sequence, remember]);
  const sendView = (type, value, side = activeSide) => setCommand(old => ({
    type, zoom: value, side, sequence: (old?.sequence ?? 0) + 1,
  }));
  const viewChanged = useCallback((side, value) => {
    setZooms(old => old[side] === value ? old : { ...old, [side]: value });
  }, []);
  const selectFinding = finding => {
    const entry = navigation.entries.find(value => value.id === finding?.id);
    if (!entry || !sideReady(entry.finding.side)) return;
    remember(entry); setSection('finding');
    // Side selection may clear the parent selection, so the finding comes last.
    if (entry.finding.side !== activeSide) onChooseSide(entry.finding.side);
    onSelect(entry.finding);
  };
  const chooseSide = side => {
    if (side === activeSide) return;
    onClear(); onChooseSide(side); setSection(['centering', 'fingerprint'].includes(section) ? section : 'whole');
    if (section === 'fingerprint') tide('REVEAL');
    sendView('FIT', undefined, side);
  };
  const chooseSection = next => {
    if (next === 'finding') {
      setSection(next);
      const target = entries.find(entry => entry.id === lastFinding[activeSide]) ?? entries[0]
        ?? otherEntries.find(entry => entry.id === lastFinding[otherSide]) ?? otherEntries[0];
      if (target) selectFinding(target.finding);
      return;
    }
    setSection(next); onClear(); sendView('FIT');
    if (next === 'fingerprint') tide('REVEAL');
  };
  const previous = position > 0 ? navigation.entries[position - 1] : null;
  const next = navigation.entries[position + 1];
  const hint = section === 'fingerprint' ? 'The saved red traces stay in place as gold contours expand from their shapes, sizes and locations.'
    : section === 'centering' ? 'Compare the saved card edge, printed border and border balance.'
    : shown ? 'The marked and unmarked views show the same saved pixels, zoom and position.'
      : entries.length ? 'Select a finding to inspect the detail.'
        : 'No included damage findings on this side. Explore the photograph or centering.';
  const findingNavigation = navigation.entries.length > 0 && <nav className="rr-public-finding-navigation" ref={findingNavigator} aria-label="Finding navigator">
      {section === 'finding' && <div className="rr-public-return"><button type="button" onClick={() => chooseSection('whole')}>← Whole card</button><button type="button" onClick={() => chooseSection('centering')}>View centering</button></div>}
    <label>All findings<select aria-label="All findings" value={shown?.id ?? ''} onChange={event => selectFinding(navigation.entries.find(entry => entry.id === event.target.value)?.finding)}>
      <option value="">Choose a finding</option>{navigation.entries.map(entry => <option key={entry.id} value={entry.id} disabled={!sideReady(entry.finding.side)}>{entry.label} · {title(entry.finding.defectType)}</option>)}
    </select></label>
    <div className="rr-public-browse"><button type="button" disabled={!previous || !sideReady(previous.finding.side)} onClick={() => selectFinding(previous?.finding)}>← Previous</button>
      <span>{shown ? `${position + 1} of ${navigation.entries.length}` : `${navigation.entries.length} findings`}</span>
      <button type="button" disabled={!next || !sideReady(next.finding.side)} onClick={() => selectFinding(next?.finding)}>Next →</button></div>
  </nav>;

  return <section className="rr-public-explorer" data-section={section} data-printing={printing} aria-label="Explore approved report evidence">
    <header className="rr-public-navigation">
      <div className="rr-public-sections" role="group" aria-label="Evidence view">
        <button type="button" aria-pressed={section === 'whole'} onClick={() => chooseSection('whole')}>Whole card</button>
        <button type="button" aria-pressed={section === 'finding'} onClick={() => chooseSection('finding')}>Findings <span>{navigation.entries.length}</span></button>
        <button type="button" aria-pressed={section === 'centering'} onClick={() => chooseSection('centering')}>Centering</button>
        <button type="button" className="rr-fingerprint-button" disabled={!ready} aria-label="ATLAS Card fingerprint" aria-pressed={section === 'fingerprint'} onClick={() => chooseSection('fingerprint')}><strong aria-hidden="true">ATLAS</strong>Card fingerprint</button>
      </div>
      <div className="rr-public-sides" role="group" aria-label="Card side">{SIDES.map(side =>
        <button type="button" key={side} aria-pressed={activeSide === side} onClick={() => chooseSide(side)}>{title(side)} <span>{navigation.entries.filter(entry => entry.finding.side === side).length}</span></button>)}</div>
    </header>
    <div className="rr-public-context">
      <div><p className="rr-public-kicker">{shown ? `${shown.label} · Saved finding` : `${title(activeSide)} · ${section === 'fingerprint' ? 'Card fingerprint' : section === 'centering' ? 'Saved centering' : 'Saved photograph'}`}</p>
        <h2>{shown ? title(shown.finding.defectType) : section === 'fingerprint' ? 'A pattern from the details.' : section === 'centering' ? 'The border balance.' : 'Every detail, in context.'}</h2></div>
      <p className="rr-public-ready" role="status">{ready ? 'Photograph verified' : 'Verifying photograph…'}</p>
    </div>
    <p className="rr-public-hint">{hint}</p>
    {section === 'finding' && findingNavigation}
    <div className="rr-public-viewers">{SIDES.map(side => <ReportInspectionImage
      key={`${side}:${report.inspection?.[side.toLowerCase()]?.imageSha256}`}
      side={side} descriptor={images?.[side]?.inspection} expectedHash={report.inspection?.[side.toLowerCase()]?.imageSha256}
      findings={sideFindings[side]} selected={!printing && section === 'finding' && current?.finding.side === side ? selected : null}
      onSelect={selectFinding} expanded={!printing && side === activeSide} hidden={!printing && side !== activeSide}
      onExpand={() => chooseSection('whole')} onReady={onReady} geometry={geometry?.[side]}
      publicMode={!printing} printMode={printing} inspectionSection={section} spatialNavigation={navigation}
      density="all" lastFindingId={lastFinding[side]}
      fingerprintCommand={fingerprintCommand} onFingerprintReturn={returnFromFingerprint}
      blueprint={false} cleanComparison={!printing && section === 'finding'} compact showFindingButtons={false} fitViewport
      layerOptions={printing ? PRINT_LAYERS : section === 'centering' ? CENTERING_LAYERS : NO_LAYERS}
      findingsVisible={printing || overlays && !['centering', 'fingerprint'].includes(section)} command={command} onViewChange={viewChanged}
      explanation={current?.finding.side === side ? explanation?.findings?.find(entry => entry.id === current.id) : null}
      centering={explanation?.sides?.[side]?.centering} policy={explanation?.policy}/>)}</div>
    <div className="rr-public-view-controls">
      {section === 'fingerprint' ? <div className="rr-fingerprint-actions"><button type="button" onClick={() => tide('RETURN')}>← Return to photograph</button>
        <button type="button" disabled={!ready || entries.length === 0} onClick={() => tide('PLAY')}>Play tide</button></div> : <>
      <div className="rr-public-overlay-controls">
        {section !== 'centering' && <button type="button" disabled={!ready} aria-pressed={overlays} onClick={() => setOverlays(value => !value)}>{overlays ? 'Hide markings' : 'Show markings'}</button>}
      </div>
      <div className="rr-public-zoom" role="group" aria-label="Photograph view">
        <button type="button" disabled={!ready} onClick={() => sendView('FIT')}>Fit</button>
        <button type="button" aria-label="Zoom out" disabled={!ready || zoom <= 1} onClick={() => sendView('ZOOM', Math.max(1, zoom / 1.5))}>−</button>
        <output aria-label="Current zoom">{number(Math.round(zoom * 10) / 10)}×</output>
        <button type="button" aria-label="Zoom in" disabled={!ready || zoom >= 16} onClick={() => sendView('ZOOM', Math.min(16, zoom * 1.5))}>+</button>
      </div>
      </>}
    </div>
    {section === 'fingerprint' && <p className="rr-fingerprint-note">Contour artwork from this side’s recorded defects. Identical recorded traces produce identical artwork. This visualization does not authenticate or identify a physical card.</p>}
    {section === 'centering' && <dl className="rr-public-centering" aria-label={`${title(activeSide)} saved centering ratios`}>
      <div><dt>Left / right</dt><dd>{ratio(centering?.leftRightBalance)}</dd></div>
      <div><dt>Top / bottom</dt><dd>{ratio(centering?.topBottomBalance)}</dd></div>
      <div><dt>Recorded centering score</dt><dd>{Number.isFinite(centering?.score) ? `${number(centering.score)} / 10` : 'Unavailable'}</dd></div>
    </dl>}
    {entries.length === 0 && !['centering', 'fingerprint'].includes(section) && <div className="rr-public-empty"><p>No included damage findings on {title(activeSide)}.</p>
      {otherEntries.length > 0 ? <button type="button" disabled={!sideReady(otherSide)} onClick={() => selectFinding(otherEntries[0].finding)}>Explore {otherEntries.length} {title(otherSide)} {otherEntries.length === 1 ? 'finding' : 'findings'} →</button>
        : <button type="button" onClick={() => chooseSection('centering')}>Explore centering →</button>}</div>}
    {section !== 'finding' && findingNavigation}
    {shown && <section className="rr-public-finding-readout" aria-label={`${shown.label} saved measurements`}>
      {findingDetails}
    </section>}
  </section>;
}
