import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { useVerifiedImage } from './verified-image.mjs';
import { ReportInspectionImage } from './ReportInspectionImage.jsx';
import { CardIdentityDetails, SlabPhotoHero, ReportMarketAndDealers } from './ReportPresentation.jsx';
import { boundReportPresentation } from './report-presentation-ui.mjs';
import { reportAwardedGrade, reportImagesMatch, reportFindingEntries, filterReportFindings,
  reportGeometryUnresolved, reportFindingRegions, reportGradeReason, reportFindingFragment, reportFindingFromFragment, reportFindingLink, reportDisplayGeometry } from './report-review-ui.mjs';

const SIDES = ['FRONT', 'BACK'];
const CATEGORIES = ['centering', 'corners', 'edges', 'surface'];
const words = value => String(value ?? '').toLowerCase().replaceAll('_', ' ');
const title = value => words(value).replace(/^./, letter => letter.toUpperCase());
function NumberValue({ value, unit = '', maximumFractionDigits = 6 }) {
  if (!Number.isFinite(value)) return <>Unavailable</>;
  return <><data value={value}><span className="rr-number-short">{value !== 0 && Math.abs(value) < .000001 ? value.toExponential(5) : value.toLocaleString('en-US', { maximumFractionDigits })}</span><span className="rr-number-exact">{String(value)}</span></data>{unit}</>;
}
const n = (value, unit) => <NumberValue value={value} unit={unit}/>;

function FindingCalculation({ finding, explanation, policy, printLabel }) {
  return <section className="rr-finding-detail" aria-label={printLabel ? `${printLabel} calculation` : 'Selected finding calculation'}>
    <div className="rr-section-heading"><div><p className="rr-eyebrow">{printLabel ? `FINDING · ${printLabel}` : `SELECTED FINDING · ${title(finding.side)}`}</p><h3>{title(finding.defectType)}</h3></div><span className="rr-badge">{explanation.included ? 'Included in grade' : 'Removed · excluded'}</span></div>
    {!printLabel && <p>{explanation.included ? 'Saved trace for this finding. Measured area excludes pixels outside the card material and overlapping pixels assigned to another finding.' : 'This finding remains in the review history and contributes no damage or deduction.'}</p>}
    {explanation.included && explanation.regions.length === 0 && <p className="rr-tolerance-note">No owned damage pixels remain after clipping and overlap assignment. This finding has no deduction.</p>}
    {explanation.regions.map((region, index) => <article className="rr-region" key={`${region.zone}:${index}`}>
      <h4>{title(region.zone)} region</h4>
      <dl className="rr-measurements"><div><dt>Measured area</dt><dd>{n(region.areaMm2, ' mm²')}</dd></div><div><dt>Measured pixels</dt><dd>{region.pixelCount === undefined ? 'Not recorded' : n(region.pixelCount)}</dd></div><div><dt>Region bounds (W × H)</dt><dd>{n(region.widthMm)} × {n(region.heightMm, ' mm')}</dd></div><div><dt>Region coverage</dt><dd>{n(region.zonePercent, '%')}</dd></div></dl>
      <div className="rr-equations"><p><span>Weighted damage area</span>{n(region.areaMm2)} mm² × {n(region.multiplier)} = <strong>{n(region.weightedAreaMm2, ' mm²')}</strong></p>
        {region.eligibleAreaMm2 !== null && <p><span>Share of the {words(region.zone)} area</span>{n(region.weightedAreaMm2)} ÷ {n(region.eligibleAreaMm2)} mm² × 100 = <strong>{n(region.weightedDamagePercent, '%')}</strong></p>}
        {explanation.included && <><p><span>Marginal {words(region.zone)} subgrade effect</span>{Number.isFinite(region.scoreWithoutFinding) && Number.isFinite(region.scoreWithFinding) ? <>{n(region.scoreWithoutFinding)} without this region − {n(region.scoreWithFinding)} with it, × {n(finding.side === 'FRONT' ? policy.frontWeight : policy.backWeight)} = </> : null}<strong>{n(region.marginalSubgradeEffect, ' points')}</strong></p>
          <p><span>Marginal unrounded overall effect</span>{n(region.marginalSubgradeEffect)} × {n(policy.categoryWeight)} = <strong>{n(region.marginalOverallEffect, ' points')}</strong></p></>}
      </div>
      {explanation.included && region.marginalSubgradeEffect === 0 && <p className="rr-tolerance-note">This measured damage does not cross a scoring threshold, so removing this region alone would not change the grade.</p>}
    </article>)}
    {!printLabel && <p className="rr-help">Marginal effects compare the grade with and without one measured region; overlap ownership is not remeasured. These effects are not additive. The category calculation uses all included weighted damage together. Use “Show full precision” for every stored digit.</p>}
  </section>;
}

/** Partial reports expose only measurements already recorded in this frame. */
function FindingMeasurements({ finding, printLabel }) {
  return <section className="rr-finding-detail" aria-label={printLabel ? `${printLabel} measurements` : 'Selected finding measurements'}>
    <h3>{printLabel ? `${printLabel} · ` : ''}{title(finding.defectType)}</h3>
    <p>{finding.geometryExclusion ? 'Removed observation retained in its previous image frame. Add a new trace in Findings to restore it on the current photograph.' : finding.reviewResult === 'REMOVED' ? 'Removed from the current findings; retained in review history.' : 'Measured in the current saved card frame. The overall grade is unavailable until centering geometry is resolved.'}</p>
    {reportFindingRegions(finding).map((region, index) => <article key={`${region.zone}:${index}`}>
      <h4>{title(region.zone)} region</h4><dl className="rr-measurements">
        <div><dt>Measured area</dt><dd>{n(region.measurement?.areaMm2, ' mm²')}</dd></div>
        <div><dt>Measured pixels</dt><dd>{n(region.measurement?.pixelCount)}</dd></div>
        <div><dt>Region bounds (W × H)</dt><dd>{n(region.measurement?.widthMm)} × {n(region.measurement?.heightMm, ' mm')}</dd></div>
      </dl>
    </article>)}
  </section>;
}

function FindingSummary({ finding, explanation, partial }) {
  const regions = partial ? reportFindingRegions(finding).map(region => ({ ...region, ...region.measurement })) : explanation?.regions ?? [];
  return <section className="rr-finding-summary" aria-label="Selected finding overview">
    <p className="rr-eyebrow">{title(finding.side)} · {finding.reviewResult === 'REMOVED' ? 'Removed from grade' : 'Recorded evidence'}</p>
    <h3>{title(finding.defectType)}</h3>
    {regions.map((region, index) => <div className="rr-finding-facts" key={`${region.zone}:${index}`}>
      <span>{title(region.zone)}</span><dl><div><dt>Measured area</dt><dd>{n(region.areaMm2, ' mm²')}</dd></div>
        <div><dt>Region bounds (W × H)</dt><dd>{n(region.widthMm)} × {n(region.heightMm, ' mm')}</dd></div>
        {!partial && <div><dt>Effect on unrounded grade</dt><dd>{n(region.marginalOverallEffect, ' points')}</dd></div>}</dl>
    </div>)}
    <p className="rr-help">{partial ? 'Measurements are saved. The overall grade awaits supported centering geometry.' : 'Each effect compares the grade with and without that region. Effects cannot be added together.'}</p>
  </section>;
}

function InspectionDock({ activeSide, chooseSide, expanded, setExpanded, panelOpen, setPanelOpen, layers, setLayers,
  overlays, setOverlays, zoom, sendView, ready, geometry, findingCount, cleanComparison, setCleanComparison, blueprint, setBlueprint, onDetails }) {
  return <div className="rr-inspect-dock" aria-label="Inspection controls">
    <div className="rr-side-switch" aria-label="Card side">{SIDES.map(side => <button type="button" key={side} aria-pressed={activeSide === side} onClick={() => chooseSide(side)}>{title(side)}</button>)}</div>
    <button type="button" aria-expanded={panelOpen} aria-controls="atlas-inspect-findings" onClick={() => setPanelOpen(value => !value)}>Findings <span>{findingCount}</span></button>
    <button type="button" onClick={onDetails}>Card details</button>
    <details className="rr-dock-menu"><summary>Layers</summary><div>
      <label><input type="checkbox" checked={blueprint} onChange={event => setBlueprint(event.target.checked)}/>Measurement callouts</label>
      {[["physical", "Card edge", geometry?.physicalQuad], ["printed", "Printed border", geometry?.printedQuad], ["centering", "Centering guides", geometry?.printedQuad]].map(([key, label, available]) => <label key={key}><input type="checkbox" checked={Boolean(available) && layers[key]} disabled={!available} onChange={event => setLayers(old => ({ ...old, [key]: event.target.checked }))}/><span>{label}{!available && <small>Unavailable on {title(activeSide)}</small>}</span></label>)}
      <label><input type="checkbox" checked={overlays} onChange={event => setOverlays(event.target.checked)}/>Defect markings</label>
    </div></details>
    <button type="button" disabled={!ready} onClick={() => sendView('FIT')}>Fit</button>
    <details className="rr-dock-menu rr-view-menu"><summary>View <span>{Number(zoom.toFixed(1))}×</span></summary><div>
      <div className="rr-zoom-stepper"><button type="button" aria-label="Zoom out" disabled={!ready || zoom <= 1} onClick={() => sendView('ZOOM', zoom / 1.5)}>−</button><output aria-label="Current zoom">{Number(zoom.toFixed(1))}×</output><button type="button" aria-label="Zoom in" disabled={!ready || zoom >= 16} onClick={() => sendView('ZOOM', zoom * 1.5)}>+</button></div>
      <label><input type="checkbox" checked={cleanComparison} onChange={event => setCleanComparison(event.target.checked)}/>Unmarked defect comparison</label>
      <label><input type="checkbox" checked={!expanded} onChange={event => setExpanded(event.target.checked ? null : activeSide)}/>Compare front & back</label>
      <p>Drag to pan. Pinch or scroll to zoom.<br/>Arrow keys pan · + / − zoom · 0 fits.<br/>[ / ] move between findings.</p>
    </div></details>
  </div>;
}

function CategoryCalculation({ category, explanation }) {
  const result = explanation.categories[category], policy = explanation.policy;
  return <article className="rr-category"><header><h3>{title(category)}</h3><strong>{n(result.subgrade)}</strong></header>
    {SIDES.map(side => {
      const value = explanation.sides[side][category === 'centering' ? category : category.toUpperCase()];
      return <section key={side}><h4>{title(side)} <span>{n(value.score)} / 10</span></h4><ThresholdVisual category={category} value={value}/>
        {category === 'centering' ? <><p>Left / right: {n(value.leftRightBalance[0])} / {n(value.leftRightBalance[1])}</p><p>Top / bottom: {n(value.topBottomBalance[0])} / {n(value.topBottomBalance[1])}</p><p>Largest border share: {n(value.worstPercent, '%')}</p><p>Grade-10 limit: {n(policy.centering.toleranceWorstPercent, '%')} on either border. {value.withinTenTolerance ? 'Within tolerance.' : 'Outside tolerance; see the centering rule below.'}</p></> : <><p>Included damage: {n(value.rawAreaMm2, ' mm²')}</p><p>Weighted damage: {n(value.weightedAreaMm2, ' mm²')}{value.eligibleAreaMm2 !== null ? <> ÷ {n(value.eligibleAreaMm2, ' mm²')} × 100 = <strong>{n(value.weightedDamagePercent, '%')}</strong></> : <>. Category damage: <strong>{n(value.weightedDamagePercent, '%')}</strong>; no included measured area.</>}</p>
          {value.tenBandMaxWeightedAreaMm2 !== null && <p>Grade-10 allowance: {n(value.tenBandMaxWeightedAreaMm2, ' weighted mm²')}</p>}
          <p>Deduction from 10: {n(value.deductionFromTen, ' points')}</p></>}
      </section>;
    })}
    <p className="rr-category-total">{n(result.frontScore)} × {n(policy.frontWeight)} + {n(result.backScore)} × {n(policy.backWeight)} = <strong>{n(result.subgrade)}</strong></p>
    <p>Overall contribution: {n(result.subgrade)} × {n(policy.categoryWeight)} = {n(result.overallContribution)}</p>
  </article>;
}

function ThresholdVisual({ category, value }) {
  const centering = category === 'centering', amount = centering ? value.worstPercent : value.weightedDamagePercent;
  if (!Number.isFinite(amount)) return null;
  const minimum = centering ? 50 : 0, maximum = centering ? 100 : Math.max(10, amount);
  const percent = (number) => Math.max(0, Math.min(100, (number - minimum) / (maximum - minimum) * 100));
  return <div className="rr-threshold"><div className="rr-threshold-caption"><span>{centering ? 'Largest border share' : 'Weighted category damage'}</span><strong>{n(amount, '%')}</strong></div>
    <div className="rr-threshold-track" aria-hidden="true"><span className="rr-threshold-ten" style={{ width: `${percent(centering ? 55 : .2)}%` }}/><span className="rr-threshold-fill" style={{ width: `${percent(amount)}%` }}/><span className="rr-threshold-position" style={{ left: `${percent(amount)}%` }}/></div>
    <div className="rr-threshold-scale"><span>{minimum}%</span><span>10 band: ≤{centering ? '55' : '0.2'}%</span><span>{maximum}%</span></div>
    {!centering && value.scoreBand && <p className="rr-band-label">{value.scoreBand.label} → side score {value.scoreBand.score}</p>}
  </div>;
}

/** Presentation receives a verified report; it never computes or grants approval. */
function explanationMatches(report, explanation) {
  return Number.isFinite(reportAwardedGrade(report)) && Array.isArray(report?.findings)
    && explanation?.ruleVersion === report.ruleVersion && explanation?.policy && explanation?.categories && explanation?.sides
    && explanation.overall?.finalGrade === reportAwardedGrade(report) && Array.isArray(explanation.findings)
    && report.findings.length === explanation.findings.length
    && report.findings.every(finding => explanation.findings.some(value => value.id === finding.id && value.side === finding.side));
}

export function FinalReportReview({ preview, workspace, images, current = true, approved = false, rejectedSuggestions = 0,
  onReadyChange, children, geometry, inspectionMode, brandSrc = '/brand/atlas-grading-logo.png', publication }) {
  const report = preview?.review?.report, explanation = preview?.review?.explanation;
  const available = Boolean(current && reportImagesMatch(report, workspace) && explanationMatches(report, explanation));
  return <ReportExperience report={report} explanation={explanation} available={available} images={images} approved={approved}
    reportKey={preview?.reportHash} inspectionMode={inspectionMode} rejectedSuggestions={rejectedSuggestions} onReadyChange={onReadyChange}
    geometry={reportDisplayGeometry(geometry, report)} brandSrc={brandSrc} publication={publication}>{children}</ReportExperience>;
}

/** Machine evidence is visibly provisional. No HUMAN inspection fields are
 * introduced: bitmap verification enables the explicit human decision below. */
export function MachineReportReview({ packet, onReadyChange, onCorrectFinding, inspectionMode, guidedFindingId, onFindingSelect, children, brandSrc = '/brand/atlas-grading-logo.png' }) {
  const source = packet?.report;
  const corrected = source?.version === 'atlas-review-provisional-report-v1' && source.authority === 'HUMAN_REVIEW_DRAFT';
  const evidenceAvailable = Array.isArray(source?.findings)
    && SIDES.every(side => /^[a-f0-9]{64}$/.test(source?.geometry?.[side]?.frame?.inspectionImageSha256 ?? ''));
  const partial = reportGeometryUnresolved(source);
  const report = useMemo(() => evidenceAvailable ? { ...source,
    findingCounts: { total: source.findings.length, included: source.findings.filter(f => f.reviewResult !== 'REMOVED').length,
      removed: source.findings.filter(f => f.reviewResult === 'REMOVED').length, unreviewed: source.findings.filter(f => f.reviewResult === 'UNREVIEWED').length },
    inspection: { method: 'MACHINE', ...Object.fromEntries(SIDES.map(side => [side.toLowerCase(), {
      imageSha256: source.geometry[side].frame.inspectionImageSha256,
    }])) },
  } : null, [source, evidenceAvailable]);
  const available = Boolean((source?.version === 'atlas-machine-provisional-report-v1' && source.authority === 'MACHINE_PROPOSAL' || corrected)
    && source.certification === null && /^[a-f0-9]{64}$/.test(packet?.reportHash ?? '')
    && evidenceAvailable && (partial || explanationMatches(report, packet?.explanation)));
  const geometry = evidenceAvailable && Object.fromEntries(SIDES.map(side => [side, {
    physicalQuad: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], printedQuad: source.geometry[side].centeringQuad,
  }]));
  return <ReportExperience report={report} explanation={packet?.explanation} available={available} images={packet?.images}
    reportKey={packet?.reportHash} geometry={geometry} brandSrc={brandSrc} machine corrected={corrected} inspectionMode={inspectionMode} guidedFindingId={guidedFindingId} onFindingSelect={onFindingSelect} onReadyChange={onReadyChange} onCorrectFinding={onCorrectFinding}>{children}</ReportExperience>;
}

/** Server-parsed approved projection only. No workspace, action callbacks or staff approval controls. */
export function ApprovedReportView({ report, explanation, images, publication, geometry, brandSrc = '/brand/atlas-grading-logo.png', children, presentation }) {
  const available = Boolean(explanationMatches(report, explanation) && Number.isSafeInteger(publication?.version)
    && publication.version > 0 && /^[a-f0-9]{64}$/.test(publication.reportHash ?? '')
    && SIDES.every(side => /^[a-f0-9]{64}$/.test(report?.inspection?.[side.toLowerCase()]?.imageSha256 ?? '')));
  return <ReportExperience report={report} explanation={explanation} available={available} images={images} approved publicView
    reportKey={publication?.reportHash} geometry={reportDisplayGeometry(geometry, report)} brandSrc={brandSrc} publication={publication}
    presentation={boundReportPresentation(presentation, publication)}>{children}</ReportExperience>;
}

export function IllustrativeReportView(props) { return <ReportExperience {...props} available publicView illustrative/>; }

function ReportExperience({ report, explanation, available, images, approved = false, publicView = false, illustrative = false, reportKey,
  rejectedSuggestions = 0, onReadyChange, onCorrectFinding, children, geometry, brandSrc, publication, presentation, machine = false, corrected = false, inspectionMode, guidedFindingId, onFindingSelect }) {
  const partial = machine && reportGeometryUnresolved(report);
  const finalGrade = reportAwardedGrade(report), halfPointGrade = machine || report?.version === 'atlas-manual-draft-report-v2';
  const CalculationContainer = machine || inspectionMode ? 'details' : 'section';
  const [selected, setSelected] = useState(null), [expanded, setExpanded] = useState(inspectionMode ? null : 'FRONT'), [ready, setReady] = useState({});
  const [activeSide, setActiveSide] = useState('FRONT'), [panelOpen, setPanelOpen] = useState(inspectionMode !== 'geometry');
  const [layers, setLayers] = useState({ physical: true, printed: true, centering: true }), [overlays, setOverlays] = useState(true);
  const [cleanComparison, setCleanComparison] = useState(true), [blueprint, setBlueprint] = useState(true), [detailsOpen, setDetailsOpen] = useState(false);
  const [command, setCommand] = useState(null), [zooms, setZooms] = useState({ FRONT: 1, BACK: 1 });
  const viewChanged = useCallback((side, zoom) => setZooms(old => old[side] === zoom ? old : { ...old, [side]: zoom }), []);
  const [sideFilter, setSideFilter] = useState('ALL'), [categoryFilter, setCategoryFilter] = useState('ALL');
  const [precise, setPrecise] = useState(false), [printing, setPrinting] = useState(false);
  const sideFindings = useMemo(() => Object.fromEntries(SIDES.map(side => [side, report?.findings?.filter(finding => finding.side === side) ?? []])), [report]);
  const entries = useMemo(() => reportFindingEntries(report?.findings ?? []), [report]);
  const filtered = useMemo(() => printing ? entries : filterReportFindings(entries, sideFilter, categoryFilter), [entries, sideFilter, categoryFilter, printing]);
  const imageReady = useCallback((side, value, hash) => setReady(previous => previous[side]?.value === value && previous[side]?.hash === hash ? previous : { ...previous, [side]: { value, hash } }), []);
  const sideReady = side => ready[side]?.value === true && ready[side]?.hash === report?.inspection?.[side.toLowerCase()]?.imageSha256;
  const bothReady = Boolean(available && SIDES.every(sideReady));
  const approvalReady = bothReady && !partial;
  useEffect(() => { onReadyChange?.(approvalReady); return () => onReadyChange?.(false); }, [approvalReady, onReadyChange]);
  const select = finding => {
    onFindingSelect?.(finding.id);
    setSelected(previous => ({ id: finding.id, sequence: (previous?.sequence ?? 0) + 1 }));
    setActiveSide(finding.side); setPanelOpen(true);
    setExpanded(finding.side);
  };
  useEffect(() => {
    if (inspectionMode !== 'findings' || !guidedFindingId) return;
    const finding = report?.findings?.find(value => value.id === guidedFindingId);
    if (finding && selected?.id !== finding.id) {
      setSelected(previous => ({id:finding.id,sequence:(previous?.sequence ?? 0)+1}));
      setActiveSide(finding.side); setPanelOpen(true); setExpanded(finding.side);
    }
  }, [inspectionMode, guidedFindingId, report, selected?.id]);
  useEffect(() => {
    if (typeof window === 'undefined' || !available) return;
    const followLink = () => { const finding = reportFindingFromFragment(window.location.hash, reportKey, report.findings);
      if (finding) { setSideFilter('ALL'); setCategoryFilter('ALL'); setActiveSide(finding.side); setExpanded(finding.side); setPanelOpen(true); setSelected(previous => ({ id: finding.id, sequence: (previous?.sequence ?? 0) + 1 })); } };
    followLink(); window.addEventListener('hashchange', followLink); return () => window.removeEventListener('hashchange', followLink);
  }, [available, reportKey, report]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const before = () => flushSync(() => setPrinting(true)), after = () => setPrinting(false);
    window.addEventListener('beforeprint', before); window.addEventListener('afterprint', after);
    return () => { window.removeEventListener('beforeprint', before); window.removeEventListener('afterprint', after); };
  }, []);
  const selectedFinding = report?.findings?.find(finding => finding.id === selected?.id);
  const selectedExplanation = explanation?.findings?.find(finding => finding.id === selected?.id);
  const position = filtered.findIndex(entry => entry.finding.id === selected?.id);
  const step = direction => { if (filtered.length) select(filtered[position < 0 ? direction > 0 ? 0 : filtered.length - 1 : (position + direction + filtered.length) % filtered.length].finding); };
  const chooseCategory = category => { setCategoryFilter(category); setSelected(null); };
  const chooseSide = side => { setActiveSide(side); if (selectedFinding?.side !== side) setSelected(null); if (expanded) setExpanded(side); };
  const sendView = (type, zoom) => setCommand(old => ({ type, zoom, side: activeSide, sequence: (old?.sequence ?? 0) + 1 }));
  const fragment = selectedFinding && reportFindingFragment(reportKey, selectedFinding.id);
  const findingLink = publicView ? reportFindingLink(publication, fragment) : fragment;
  if (!available) return <section className="rr-report" aria-label="Final draft review unavailable"><div className="rr-unavailable"><h1>{publicView ? 'Report temporarily unavailable' : 'Review draft report'}</h1><p role="alert">{publicView ? 'The approved evidence could not be verified. Please try again later.' : 'The full report does not match the current saved review. Return to Findings and open the draft report again.'}</p></div></section>;
  const identity = report.identity, name = identity.playerName ?? identity.cardName;
  const identityLine = [identity.year, identity.manufacturer, identity.productSet, identity.parallel, identity.insert, identity.cardNumber && `#${identity.cardNumber}`].filter(Boolean).join(' · ');
  return <section className={`rr-report rr-inspect${precise ? ' rr-precision' : ''}${printing ? ' rr-printing' : ''}${publicView ? ' rr-public' : ''}${machine ? ' rr-machine' : ''}${inspectionMode ? ' rr-guided rr-guided-' + inspectionMode : ''}`} data-finding-selected={Boolean(selectedFinding)} aria-label={publicView ? 'Approved ATLAS grading report' : 'Final draft report review'} onKeyDown={event => {
    if (event.altKey || event.ctrlKey || event.metaKey || /INPUT|TEXTAREA|SELECT/.test(event.target?.tagName ?? '') || event.target?.isContentEditable) return;
    if (!inspectionMode && (event.key === '[' || event.key === ']')) { event.preventDefault(); event.stopPropagation(); step(event.key === ']' ? 1 : -1); }
  }}>
    <header className="rr-heading"><div className="rr-hero-copy"><img className="rr-brand" src={brandSrc} alt="ATLAS Grading · Know what you have"/>
      <p className="rr-eyebrow">{illustrative ? 'ILLUSTRATIVE DEMO · REAL ALAKAZAM REPORT PENDING' : corrected ? 'CURRENT CORRECTIONS · PROVISIONAL' : machine ? 'ATLAS PROPOSAL · HUMAN REVIEW' : approved ? 'HUMAN-APPROVED REPORT' : 'FINAL HUMAN REVIEW · DRAFT'}</p><h1>{name}</h1><p className="rr-identity">{identityLine}</p>
      <div className="rr-trust-row"><span>{illustrative ? 'Authored example · Not certified' : machine ? 'Awaiting your review' : approved ? 'Approved snapshot' : 'Awaiting separate approval'}</span><span>{entries.length} included {entries.length === 1 ? 'finding' : 'findings'}</span>{publication?.version && <span>Version {publication.version}</span>}</div>
      {!publicView && <p className="rr-review-history">{report.findingCounts.removed ?? 0} removed findings · {rejectedSuggestions} rejected suggestions</p>}
    </div><div className={`rr-overall${partial ? ' rr-overall-unavailable' : ''}`}><span>{illustrative ? 'ILLUSTRATIVE GRADE' : machine ? 'PROPOSED GRADE' : approved ? 'APPROVED GRADE' : 'DRAFT GRADE'}</span><strong>{partial ? 'Unavailable' : finalGrade}</strong>{!partial && <span>ATLAS / 10</span>}<p>{partial ? 'Centering geometry needs review' : halfPointGrade ? 'Whole & half-point award' : 'Original historical grade'}</p></div></header>
    <section className="rr-photo-review" aria-label="Report photographs and findings">
      <div className="rr-inspect-title"><h2>ATLAS <span>INSPECT</span></h2><p role="status">{illustrative ? 'Reference image · Illustrative overlays' : bothReady ? 'Both photographs verified' : 'Verifying photographs…'}{illustrative ? '' : machine ? ' · Human review required' : approved ? ' · Approved evidence' : ' · Draft review'}</p>
        {publicView && entries.length > 0 && <button type="button" disabled={!bothReady} onClick={() => { setSideFilter('ALL'); setCategoryFilter('ALL'); select(entries[0].finding); }}>See why it’s {finalGrade} ↗</button>}
      </div>
      <InspectionDock activeSide={activeSide} chooseSide={chooseSide} expanded={expanded} setExpanded={setExpanded} panelOpen={panelOpen} setPanelOpen={setPanelOpen}
        layers={layers} setLayers={setLayers} overlays={overlays} setOverlays={setOverlays} zoom={zooms[activeSide]} sendView={sendView} ready={sideReady(activeSide)} geometry={geometry?.[activeSide]} findingCount={entries.length} cleanComparison={cleanComparison} setCleanComparison={setCleanComparison} blueprint={blueprint} setBlueprint={setBlueprint} onDetails={() => setDetailsOpen(value => !value)}/>
      {detailsOpen && <div className="rr-inline-details"><CardIdentityDetails report={report} details={presentation?.details}/></div>}
      <div className={`rr-evidence-layout${panelOpen ? '' : ' rr-panel-closed'}`}>
        <div className="rr-evidence-main"><div className={`rr-image-pair${expanded && !printing ? ' rr-pair-expanded' : ''}`}>
          {SIDES.map(side => <ReportInspectionImage key={`${side}:${report.inspection[side.toLowerCase()].imageSha256}`} side={side}
            illustrative={illustrative} descriptor={images?.[side]?.inspection} expectedHash={report.inspection[side.toLowerCase()].imageSha256} findings={sideFindings[side]} selected={selected}
            onSelect={finding => { setSideFilter('ALL'); setCategoryFilter('ALL'); select(finding); }} expanded={expanded === side && !printing} hidden={!printing && Boolean(expanded && expanded !== side)}
            onExpand={setExpanded} onReady={imageReady} geometry={geometry?.[side]} showFindingButtons={false} compact fitViewport={Boolean(inspectionMode)}
            layerOptions={layers} findingsVisible={overlays} command={command} onViewChange={viewChanged} onActivate={setActiveSide} cleanComparison={cleanComparison && Boolean(expanded) && !printing} blueprint={blueprint && !printing} explanation={selectedFinding?.side === side ? selectedExplanation : null} centering={explanation?.sides?.[side]?.centering} policy={explanation?.policy}/>)}</div>
          <div className="rr-stage-caption"><span>{expanded ? title(activeSide) : 'Front & Back'} · Saved photograph</span><span>Drag to pan · Scroll or pinch to zoom</span></div>
        </div>
        <aside id="atlas-inspect-findings" className="rr-findings-panel" hidden={!panelOpen && !printing} aria-label="Finding navigator">
          <div className="rr-findings-heading"><h3>{selectedFinding ? 'In focus' : 'Findings'}</h3><span>{position >= 0 ? `${position + 1} / ${filtered.length}` : `${entries.length} recorded`}</span></div>
          {selectedFinding && (selectedExplanation || partial) ? <>
            <FindingSummary finding={selectedFinding} explanation={selectedExplanation} partial={partial}/>
            {machine && !inspectionMode && onCorrectFinding && <button className="rr-correct-finding" type="button" onClick={() => onCorrectFinding(selectedFinding)}>Review or correct this finding ↗</button>}
            <details className="rr-full-measurements"><summary>Measurements & grade effect</summary>{partial ? <FindingMeasurements finding={selectedFinding}/> : <FindingCalculation finding={selectedFinding} explanation={selectedExplanation} policy={explanation.policy}/>}
              <button type="button" aria-pressed={precise} onClick={() => setPrecise(value => !value)}>{precise ? 'Use readable precision' : 'Show full precision'}</button>
              {findingLink && <a href={findingLink}>Link to this finding</a>}
            </details>
          </> : <p className="rr-selection-prompt">{entries.length ? 'Select a number on the card. Follow its exact trace, size and grade effect here.' : partial ? 'No included damage findings. Centering and the overall grade remain unavailable.' : 'No included damage findings. Explore the saved borders and grade calculation.'}</p>}
          {!inspectionMode && <div className="rr-finding-pagination"><button type="button" title="Previous finding ( [ )" disabled={!filtered.length} onClick={() => step(-1)}>Previous finding</button><button type="button" title="Next finding ( ] )" disabled={!filtered.length} onClick={() => step(1)}>Next finding</button></div>}
          <details className="rr-finding-index" open={!selectedFinding}><summary>All findings <span>{filtered.length}</span></summary>
            <div className="rr-filters"><label>Side<select aria-label="Filter findings by side" value={sideFilter} onChange={event => { setSideFilter(event.target.value); setSelected(null); }}>{['ALL', ...SIDES].map(side => <option key={side} value={side}>{side === 'ALL' ? 'Both sides' : title(side)}</option>)}</select></label><label>Category<select aria-label="Filter findings by category" value={categoryFilter} onChange={event => chooseCategory(event.target.value)}><option value="ALL">All categories</option>{CATEGORIES.map(category => <option key={category} value={category}>{title(category)}</option>)}</select></label></div>
            <ol className="rr-finding-list">{filtered.map(({ finding, number, label, categories }) => <li key={finding.id}><button type="button" aria-label={`${label} · ${words(finding.defectType)}`} disabled={!sideReady(finding.side)} aria-pressed={selected?.id === finding.id} onClick={() => select(finding)}><span className="rr-finding-number" aria-hidden="true">{number}</span><span><strong>{label} · {words(finding.defectType)}</strong><small>{categories.map(title).join(' · ') || 'No owned damage pixels'} · {machine ? 'Proposed' : 'Confirmed'}</small></span></button></li>)}</ol>
          </details>
          {!filtered.length && <p className="rr-help">{categoryFilter === 'centering' ? partial ? 'Centering requires supported printed-border geometry. Open Geometry to resolve it.' : 'Centering uses the saved border geometry, not a damage finding. Open the Centering calculation below.' : entries.length ? 'No findings match these filters.' : 'No included damage findings.'}</p>}
          <p className="rr-review-progress">{illustrative ? 'Illustrative example · Not a certified report' : machine ? `${entries.length} proposals · Final human confirmation required` : approved ? 'This is the approved report.' : `${report.findingCounts.unreviewed ?? 0} findings awaiting confirmation`}</p>
          {!publicView && <p className="rr-help">Selecting or moving past a finding does not confirm it.</p>}
        </aside>
      </div>
      {!publicView && report.findingCounts.removed > 0 && <details className="rr-removed"><summary>Removed findings · {report.findingCounts.removed}</summary><p>Retained in review history; excluded from the grade.</p>{report.findings.filter(finding => finding.reviewResult === 'REMOVED').map(finding => <button key={finding.id} type="button" onClick={() => select(finding)}>{title(finding.side)} · {words(finding.defectType)}</button>)}</details>}
    </section>
    {machine && !inspectionMode && <details className="rr-review-summary"><summary>Review summary <span>{partial ? 'Centering unresolved' : 'Confirm or correct, then approve'} →</span></summary>
      <p>{partial ? 'Review the geometry and findings. Approval is unavailable until the missing centering geometry is resolved.' : 'Approve confirms both photos, card details, outlines, findings and grade.'} {bothReady ? 'Both photos verified.' : 'Verifying both photos…'}</p>{children}
    </details>}
    {partial ? <section className="rr-why rr-unresolved" aria-label="Unresolved centering geometry"><div><p className="rr-eyebrow">PARTIAL REPORT · FINAL HUMAN REVIEW</p><h2>Centering needs review</h2></div><div><p>Defect analysis and measurements are saved. Open Geometry to check the physical outline and supply a supported printed border on {Array.from(new Set(report.unresolvedGeometry.map(value => value.side))).map(title).join(' and ')}. Then review both sides and the findings. ATLAS will recalculate the grade from the corrected evidence.</p><p>A borderless or full-bleed card remains unresolved until a supported centering rule is available. No centering value or overall grade has been assumed.</p></div></section> : <>
    <section className="rr-why" aria-label="Why this grade"><div><p className="rr-eyebrow">THE RESULT, EXPLAINED</p><h2>Why this grade</h2></div><p>{corrected ? 'ATLAS recalculated this provisional grade from the current saved geometry and findings. Final human approval is still required.' : machine ? 'ATLAS proposes these outlines and findings. The saved traces were measured with ATLAS grading rules.' : reportGradeReason(report)} {halfPointGrade ? <>The final award rounds the raw calculation directly to the nearest half point.</> : <>This report retains its original tenth-point policy.</>}</p></section>
    <div className="rr-score-strip">{CATEGORIES.map((category, index) => <button type="button" key={category} onClick={() => chooseCategory(category)} aria-pressed={categoryFilter === category}><span className="rr-score-index">0{index + 1}</span><span>{title(category)}</span><strong><NumberValue value={report.grade.subgrades[category]} maximumFractionDigits={1}/></strong><small>25% of overall</small></button>)}</div>
    </>}
    {machine && report.limitations?.length > 0 && <section className="rr-why rr-evidence-limitations" aria-label="Current evidence limitations"><h2>Evidence limitations</h2><ul>{report.limitations.map((value,index)=><li key={index}>{value}</li>)}</ul></section>}
    {corrected && report.originalMachineEvidence?.limitations?.length > 0 && <details className="rr-machine-details"><summary>Original machine warnings · historical evidence</summary><p>These warnings describe the original machine report. Current geometry and measurement status is shown above.</p><ul>{report.originalMachineEvidence.limitations.map((value,index)=><li key={index}>{value}</li>)}</ul></details>}
    {machine || inspectionMode ? <details className="rr-machine-details"><summary>Card details</summary><CardIdentityDetails report={report}/></details> : <CardIdentityDetails report={report} details={presentation?.identityDetails}/>}
    {printing && partial && entries.length > 0 && <section aria-label="All included finding measurements">{entries.map(({ finding, label }) => <FindingMeasurements key={finding.id} finding={finding} printLabel={label}/>)}</section>}
    {printing && !partial && entries.length > 0 && <section className="rr-print-findings" aria-label="All included finding calculations"><div className="rr-print-findings-intro"><p className="rr-eyebrow">EVERY CONFIRMED FINDING</p><h2>Measurements and grade effects</h2><p>Measured area excludes pixels outside the card and overlap assigned to another finding. Marginal effects compare the grade with and without one region; overlap ownership is not remeasured. Effects are not additive. The category calculation uses all included weighted damage together.</p></div>{entries.map(({ finding, label }) => <FindingCalculation key={finding.id} finding={finding} printLabel={label} explanation={explanation.findings.find(value => value.id === finding.id)} policy={explanation.policy}/>)}</section>}
    {!partial && <CalculationContainer className="rr-calculation" aria-label="Grade calculation">{(machine || inspectionMode) && <summary>Measurements & grade calculation</summary>}<div className="rr-section-heading"><div><p className="rr-eyebrow">FOLLOW THE NUMBERS</p><h2>How this grade is calculated</h2></div><button type="button" className="rr-precision-control" aria-pressed={precise} onClick={() => setPrecise(value => !value)}>{precise ? 'Use readable precision' : 'Show full precision'}</button></div>
      {finalGrade === 10 && entries.length > 0 && <p className="rr-tolerance-note">A final 10 can include measured damage. Category tolerances and final rounding explain this result; a 10 does not mean zero imperfections.</p>}
      <div className="rr-weighting"><div><span>FRONT</span><strong>{explanation.policy.frontWeight * 100}%</strong></div><div className="rr-weighting-bar" aria-hidden="true"><span style={{ width: `${explanation.policy.frontWeight * 100}%` }}/></div><div><span>BACK</span><strong>{explanation.policy.backWeight * 100}%</strong></div></div>
      <p className="rr-help">Each category combines both sides, then contributes {n(explanation.policy.categoryWeight * 100, '%')} of the overall result. Readable numbers are rounded for display; full precision exposes every stored digit.</p>
      <div className="rr-category-grid">{CATEGORIES.map(category => <details className="rr-category-disclosure" key={category} open={printing || categoryFilter === category ? true : undefined}><summary><span>{title(category)}</span><strong>{n(report.grade.subgrades[category])}</strong><span className="rr-disclosure-label">View calculation</span></summary><CategoryCalculation category={category} explanation={explanation}/></details>)}</div>
      <div className="rr-final-math"><div><p className="rr-eyebrow">ONE TRANSPARENT CALCULATION</p><h3>From category scores to the final grade</h3><p>({CATEGORIES.map((category, index) => <React.Fragment key={category}>{index > 0 ? ' + ' : ''}{n(explanation.categories[category].subgrade)}</React.Fragment>)}) ÷ 4 = <strong>{n(explanation.overall.rawGrade)}</strong> raw calculation</p></div><div className="rr-award-equation"><span>{String(explanation.overall.rawGrade)}<small>Unrounded result</small></span><span aria-hidden="true">→</span><strong>{finalGrade}<small>ATLAS award</small></strong></div>
        <details open={printing ? true : undefined}><summary>Rounding and complete calculation</summary><p>Detailed grade, rounded to the nearest tenth: <strong>{n(explanation.overall.displayGrade)}</strong></p>
        {halfPointGrade ? <><p className="rr-awarded">Final ATLAS grade, rounded to the nearest half point: <strong>{n(finalGrade)}</strong></p><p>The final grade is rounded directly from <strong>{String(explanation.overall.rawGrade)}</strong>, with exact halfway values rounded up. The tenth-point detail is not used as a second rounding input.</p></> : <p>Original historical final grade: <strong>{n(finalGrade)}</strong>. This report retains its original tenth-point policy.</p>}
        <p>Total unrounded deduction from 10: {n(explanation.overall.rawDeductionFromTen, ' points')}</p>{explanation.policy.additionalCaps === null && <p>No additional grade cap applies in this rule.</p>}</details></div>
      <details className="rr-policy" open={printing ? true : undefined}><summary>Grading thresholds and rules</summary><p>{explanation.policy.conditionFormula}</p><p>{explanation.policy.centeringFormula}</p><p>{explanation.policy.overallFormula}</p><p>{explanation.policy.finalGradeFormula}</p><table><thead><tr><th>Weighted damage in a category</th><th>Side score</th></tr></thead><tbody>{explanation.policy.conditionBands.map((band, index) => <tr key={index}><td>{band.label}</td><td>{band.score}</td></tr>)}</tbody></table><p>Rule version: {report.ruleVersion}</p></details>
    </CalculationContainer>}
    {presentation?.slabPhoto && <details className="rr-slab-disclosure"><summary>Slab photograph</summary><SlabPhotoHero key={presentation.slabPhoto.url} photo={presentation.slabPhoto} brandSrc={brandSrc}/></details>}
    {publicView && <ReportMarketAndDealers presentation={presentation} printing={printing}/>}
    {!machine && <section className="rr-provenance" aria-label="Report provenance"><div><p className="rr-eyebrow">A RECORD YOU CAN REVISIT</p><h2>{approved ? 'Approved evidence, preserved' : 'Your review, before approval'}</h2><p>{approved ? 'This view belongs to the saved approved report. Later work requires its own approval.' : 'Approval saves this exact report. Return to Findings or Geometry to make corrections first.'}</p></div><dl><div><dt>Status</dt><dd>{approved ? 'Human approved' : 'Draft · not approved'}</dd></div>{publication?.reportNumber && <div><dt>Report</dt><dd>{publication.reportNumber}</dd></div>}{publication?.version && <div><dt>Version</dt><dd>{publication.version}</dd></div>}{publication?.approvedAt && <div><dt>Approved</dt><dd>{publication.approvedAt.slice(0, 10)}</dd></div>}<div><dt>Rule</dt><dd>{report.ruleVersion}</dd></div><div><dt>Photographs</dt><dd>{bothReady ? 'Both saved photographs verified' : 'Awaiting image verification'}</dd></div></dl>
      <p className="rr-help">Photographs and derived inspection views are evidence of the recorded review. This report does not assert physical slab finishing or NFC completion.</p>
      {approved && <button type="button" className="rr-print-button" disabled={!bothReady} onClick={() => { if (typeof window !== 'undefined') window.print(); }}>Print approved report</button>}
      {reportKey && <details className="rr-report-reference" open={printing ? true : undefined}><summary>Exact report reference</summary><code>{reportKey}</code></details>}
    </section>}
    {!publicView && !machine && !approved && !inspectionMode && <footer className="rr-approval"><h2>{approved ? 'Report approved and saved' : 'Final approval'}</h2><p>{machine ? 'Review & approve confirms that you inspected both photos and accept the displayed card details, outlines, findings and grade. Corrections open the card workspace.' : 'Approval saves this exact report. Return to Findings or Geometry to make corrections before approving.'}</p>{!bothReady && <p role="status">Both saved photographs must load and verify before approval is available.</p>}{children}</footer>}
    {inspectionMode === 'summary' && children}
    {publicView && children}
  </section>;
}

export function CompletedReviewCard({descriptor, expectedHash, name, grade, reportNumber, brandSrc}) {
  const verified = useVerifiedImage(descriptor?.sha256 === expectedHash ? descriptor : null);
  return <figure className="mc-complete-card" aria-label="Approved card and ATLAS label">
    <figcaption className="mc-complete-card-label"><img src={brandSrc} alt="ATLAS Grading"/><span><b>{name}</b><small>{reportNumber}</small></span><strong>{Number.isFinite(grade) ? grade : '—'}</strong></figcaption>
    <div className="mc-complete-card-photo">{verified.url ? <img src={verified.url} alt={`${name} · approved front photograph`}/> : <span role="status">{verified.error ? 'Photo unavailable · approval saved' : 'Loading saved card…'}</span>}</div>
  </figure>;
}
