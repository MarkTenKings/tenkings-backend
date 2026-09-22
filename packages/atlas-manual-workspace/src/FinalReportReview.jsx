import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { ReportInspectionImage } from './ReportInspectionImage.jsx';
import { reportAwardedGrade, reportImagesMatch, reportFindingEntries, filterReportFindings,
  reportGradeReason, reportFindingFragment, reportFindingFromFragment, reportFindingLink, reportDisplayGeometry } from './report-review-ui.mjs';

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
      <dl className="rr-measurements"><div><dt>Measured area</dt><dd>{n(region.areaMm2, ' mm²')}</dd></div><div><dt>Measured pixels</dt><dd>{region.pixelCount === undefined ? 'Not recorded' : n(region.pixelCount)}</dd></div><div><dt>Width × height</dt><dd>{n(region.widthMm)} × {n(region.heightMm, ' mm')}</dd></div><div><dt>Region coverage</dt><dd>{n(region.zonePercent, '%')}</dd></div></dl>
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
  onReadyChange, children, geometry, brandSrc = '/brand/atlas-brand.png', publication }) {
  const report = preview?.review?.report, explanation = preview?.review?.explanation;
  const available = Boolean(current && reportImagesMatch(report, workspace) && explanationMatches(report, explanation));
  return <ReportExperience report={report} explanation={explanation} available={available} images={images} approved={approved}
    reportKey={preview?.reportHash} rejectedSuggestions={rejectedSuggestions} onReadyChange={onReadyChange}
    geometry={reportDisplayGeometry(geometry, report)} brandSrc={brandSrc} publication={publication}>{children}</ReportExperience>;
}

/** Server-parsed approved projection only. No workspace, action callbacks or staff approval controls. */
export function ApprovedReportView({ report, explanation, images, publication, geometry, brandSrc = '/brand/atlas-brand.png', children }) {
  const available = Boolean(explanationMatches(report, explanation) && Number.isSafeInteger(publication?.version)
    && publication.version > 0 && /^[a-f0-9]{64}$/.test(publication.reportHash ?? '')
    && SIDES.every(side => /^[a-f0-9]{64}$/.test(report?.inspection?.[side.toLowerCase()]?.imageSha256 ?? '')));
  return <ReportExperience report={report} explanation={explanation} available={available} images={images} approved publicView
    reportKey={publication?.reportHash} geometry={reportDisplayGeometry(geometry, report)} brandSrc={brandSrc} publication={publication}>{children}</ReportExperience>;
}

function ReportExperience({ report, explanation, available, images, approved = false, publicView = false, reportKey,
  rejectedSuggestions = 0, onReadyChange, children, geometry, brandSrc, publication }) {
  const finalGrade = reportAwardedGrade(report), halfPointGrade = report?.version === 'atlas-manual-draft-report-v2';
  const [selected, setSelected] = useState(null), [expanded, setExpanded] = useState(null), [ready, setReady] = useState({});
  const [sideFilter, setSideFilter] = useState('ALL'), [categoryFilter, setCategoryFilter] = useState('ALL');
  const [precise, setPrecise] = useState(false), [printing, setPrinting] = useState(false);
  const sideFindings = useMemo(() => Object.fromEntries(SIDES.map(side => [side, report?.findings?.filter(finding => finding.side === side) ?? []])), [report]);
  const entries = useMemo(() => reportFindingEntries(report?.findings ?? []), [report]);
  const filtered = useMemo(() => printing ? entries : filterReportFindings(entries, sideFilter, categoryFilter), [entries, sideFilter, categoryFilter, printing]);
  const imageReady = useCallback((side, value, hash) => setReady(previous => previous[side]?.value === value && previous[side]?.hash === hash ? previous : { ...previous, [side]: { value, hash } }), []);
  const sideReady = side => ready[side]?.value === true && ready[side]?.hash === report?.inspection?.[side.toLowerCase()]?.imageSha256;
  const bothReady = Boolean(available && SIDES.every(sideReady));
  useEffect(() => { onReadyChange?.(bothReady); return () => onReadyChange?.(false); }, [bothReady, onReadyChange]);
  const select = finding => {
    setSelected(previous => ({ id: finding.id, sequence: (previous?.sequence ?? 0) + 1 }));
    if (expanded && expanded !== finding.side) setExpanded(finding.side);
  };
  useEffect(() => {
    if (typeof window === 'undefined' || !available) return;
    const followLink = () => { const finding = reportFindingFromFragment(window.location.hash, reportKey, report.findings);
      if (finding) { setSideFilter('ALL'); setCategoryFilter('ALL'); setSelected(previous => ({ id: finding.id, sequence: (previous?.sequence ?? 0) + 1 })); } };
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
  const fragment = selectedFinding && reportFindingFragment(reportKey, selectedFinding.id);
  const findingLink = publicView ? reportFindingLink(publication, fragment) : fragment;
  if (!available) return <section className="rr-report" aria-label="Final draft review unavailable"><div className="rr-unavailable"><h1>{publicView ? 'Report temporarily unavailable' : 'Review draft report'}</h1><p role="alert">{publicView ? 'The approved evidence could not be verified. Please try again later.' : 'The full report does not match the current saved review. Return to Findings and open the draft report again.'}</p></div></section>;
  const identity = report.identity, name = identity.playerName ?? identity.cardName;
  const identityLine = [identity.year, identity.manufacturer, identity.productSet, identity.parallel, identity.insert, identity.cardNumber && `#${identity.cardNumber}`].filter(Boolean).join(' · ');
  return <section className={`rr-report${precise ? ' rr-precision' : ''}${printing ? ' rr-printing' : ''}${publicView ? ' rr-public' : ''}`} aria-label={publicView ? 'Approved ATLAS grading report' : 'Final draft report review'}>
    <header className="rr-heading"><div className="rr-hero-copy"><img className="rr-brand" src={brandSrc} alt="ATLAS Grading · Know what you have"/>
      <p className="rr-eyebrow">{approved ? 'HUMAN-APPROVED REPORT' : 'FINAL HUMAN REVIEW · DRAFT'}</p><h1>{name}</h1><p className="rr-identity">{identityLine}</p>
      <div className="rr-trust-row"><span>{approved ? 'Approved snapshot' : 'Awaiting separate approval'}</span><span>{entries.length} included {entries.length === 1 ? 'finding' : 'findings'}</span>{publication?.version && <span>Version {publication.version}</span>}</div>
      {!publicView && <p className="rr-review-history">{report.findingCounts.removed ?? 0} removed findings · {rejectedSuggestions} rejected suggestions</p>}
    </div><div className="rr-overall"><span>{approved ? 'APPROVED GRADE' : 'DRAFT GRADE'}</span><strong>{finalGrade}</strong><span>ATLAS / 10</span><p>{halfPointGrade ? 'Whole & half-point award' : 'Original historical grade'}</p></div></header>
    <section className="rr-why" aria-label="Why this grade"><div><p className="rr-eyebrow">THE RESULT, EXPLAINED</p><h2>Why this grade</h2></div><p>{reportGradeReason(report)} {halfPointGrade ? <>The final award rounds the raw calculation directly to the nearest half point.</> : <>This report retains its original tenth-point policy.</>}</p></section>
    <div className="rr-score-strip">{CATEGORIES.map((category, index) => <button type="button" key={category} onClick={() => chooseCategory(category)} aria-pressed={categoryFilter === category}><span className="rr-score-index">0{index + 1}</span><span>{title(category)}</span><strong><NumberValue value={report.grade.subgrades[category]} maximumFractionDigits={1}/></strong><small>25% of overall</small></button>)}</div>
    <section className="rr-photo-review" aria-label="Report photographs and findings"><div className="rr-section-heading"><div><p className="rr-eyebrow">THE EVIDENCE</p><h2>Explore every detail</h2><p>Real saved photographs. Exact confirmed markings. Select a number to follow the evidence.</p></div>{expanded && <div className="rr-side-switch">{SIDES.map(side => <button key={side} type="button" aria-pressed={expanded === side} onClick={() => setExpanded(side)}>{title(side)}</button>)}</div>}</div>
      <div className="rr-mobile-finding-nav"><button type="button" aria-label="Previous finding in compact navigator" disabled={!filtered.length} onClick={() => step(-1)}>Previous</button><select aria-label="Choose a finding in compact navigator" value={entries.some(entry => entry.finding.id === selected?.id) ? selected.id : ''} onChange={event => { const entry = entries.find(value => value.finding.id === event.target.value); if (entry) { setSideFilter('ALL'); setCategoryFilter('ALL'); select(entry.finding); } }}><option value="">Choose a finding</option>{entries.map(({ finding, label }) => <option key={finding.id} value={finding.id} disabled={!sideReady(finding.side)}>{label} · {words(finding.defectType)}</option>)}</select><button type="button" aria-label="Next finding in compact navigator" disabled={!filtered.length} onClick={() => step(1)}>Next</button></div>
      <div className="rr-evidence-layout"><div className="rr-evidence-main"><div className={`rr-image-pair${expanded ? ' rr-pair-expanded' : ''}`}>{SIDES.map(side => <ReportInspectionImage key={`${side}:${report.inspection[side.toLowerCase()].imageSha256}`} side={side} descriptor={images?.[side]?.inspection} expectedHash={report.inspection[side.toLowerCase()].imageSha256} findings={sideFindings[side]} selected={selected} onSelect={finding => { setSideFilter('ALL'); setCategoryFilter('ALL'); select(finding); }} expanded={expanded === side} hidden={Boolean(expanded && expanded !== side)} onExpand={setExpanded} onReady={imageReady} geometry={geometry?.[side]} showFindingButtons={false}/>)}</div>
      {selectedFinding && selectedExplanation ? <><div className="rr-finding-toolbar"><span role="status">{title(selectedFinding.side)} · {title(selectedFinding.defectType)}</span>{findingLink && <a href={findingLink}>Link to this finding</a>}</div><FindingCalculation finding={selectedFinding} explanation={selectedExplanation} policy={explanation.policy}/></> : <p className="rr-selection-prompt">{entries.length ? 'Choose a numbered finding to inspect its photograph, saved trace and measured effect.' : 'No included findings were recorded. The calculation also accounts for confirmed centering on both sides.'}</p>}
      </div><aside className="rr-findings-panel" aria-label="Finding navigator"><div className="rr-findings-heading"><h3>Findings</h3><span>{filtered.length} / {entries.length}</span></div>
        <div className="rr-filters"><label>Side<select aria-label="Filter findings by side" value={sideFilter} onChange={event => { setSideFilter(event.target.value); setSelected(null); }}>{['ALL', ...SIDES].map(side => <option key={side} value={side}>{side === 'ALL' ? 'Both sides' : title(side)}</option>)}</select></label><label>Category<select aria-label="Filter findings by category" value={categoryFilter} onChange={event => chooseCategory(event.target.value)}><option value="ALL">All categories</option>{CATEGORIES.map(category => <option key={category} value={category}>{title(category)}</option>)}</select></label></div>
        <div className="rr-finding-pagination"><button type="button" disabled={!filtered.length} onClick={() => step(-1)}>Previous finding</button><button type="button" disabled={!filtered.length} onClick={() => step(1)}>Next finding</button></div>
        <ol className="rr-finding-list">{filtered.map(({ finding, number, label, categories }) => <li key={finding.id}><button type="button" aria-label={`${label} · ${words(finding.defectType)}`} disabled={!sideReady(finding.side)} aria-pressed={selected?.id === finding.id} onClick={() => select(finding)}><span className="rr-finding-number" aria-hidden="true">{number}</span><span><strong>{label} · {words(finding.defectType)}</strong><small>{categories.map(title).join(' · ') || 'No owned damage pixels'} · Confirmed</small></span></button></li>)}</ol>
        {!filtered.length && <p className="rr-help">{categoryFilter === 'centering' ? 'Centering uses the saved border geometry, not a damage finding. Open the Centering calculation below.' : entries.length ? 'No findings match these filters.' : 'No included damage findings.'}</p>}
        <p className="rr-help">Numbers identify findings, not severity. Image controls never change this report.</p>
      </aside></div>
      {!publicView && report.findingCounts.removed > 0 && <details className="rr-removed"><summary>Removed findings · {report.findingCounts.removed}</summary><p>Retained in review history; excluded from the grade.</p>{report.findings.filter(finding => finding.reviewResult === 'REMOVED').map(finding => <button key={finding.id} type="button" onClick={() => select(finding)}>{title(finding.side)} · {words(finding.defectType)}</button>)}</details>}
    </section>
    {printing && entries.length > 0 && <section className="rr-print-findings" aria-label="All included finding calculations"><div className="rr-print-findings-intro"><p className="rr-eyebrow">EVERY CONFIRMED FINDING</p><h2>Measurements and grade effects</h2><p>Measured area excludes pixels outside the card and overlap assigned to another finding. Marginal effects compare the grade with and without one region; overlap ownership is not remeasured. Effects are not additive. The category calculation uses all included weighted damage together.</p></div>{entries.map(({ finding, label }) => <FindingCalculation key={finding.id} finding={finding} printLabel={label} explanation={explanation.findings.find(value => value.id === finding.id)} policy={explanation.policy}/>)}</section>}
    <section className="rr-calculation" aria-label="Grade calculation"><div className="rr-section-heading"><div><p className="rr-eyebrow">FOLLOW THE NUMBERS</p><h2>How this grade is calculated</h2></div><button type="button" className="rr-precision-control" aria-pressed={precise} onClick={() => setPrecise(value => !value)}>{precise ? 'Use readable precision' : 'Show full precision'}</button></div>
      {finalGrade === 10 && entries.length > 0 && <p className="rr-tolerance-note">A final 10 can include measured damage. Category tolerances and final rounding explain this result; a 10 does not mean zero imperfections.</p>}
      <div className="rr-weighting"><div><span>FRONT</span><strong>{explanation.policy.frontWeight * 100}%</strong></div><div className="rr-weighting-bar" aria-hidden="true"><span style={{ width: `${explanation.policy.frontWeight * 100}%` }}/></div><div><span>BACK</span><strong>{explanation.policy.backWeight * 100}%</strong></div></div>
      <p className="rr-help">Each category combines both sides, then contributes {n(explanation.policy.categoryWeight * 100, '%')} of the overall result. Readable numbers are rounded for display; full precision exposes every stored digit.</p>
      <div className="rr-category-grid">{CATEGORIES.map(category => <details className="rr-category-disclosure" key={category} open={printing || categoryFilter === category ? true : undefined}><summary><span>{title(category)}</span><strong>{n(report.grade.subgrades[category])}</strong><span className="rr-disclosure-label">View calculation</span></summary><CategoryCalculation category={category} explanation={explanation}/></details>)}</div>
      <div className="rr-final-math"><div><p className="rr-eyebrow">ONE TRANSPARENT CALCULATION</p><h3>From category scores to the final grade</h3><p>({CATEGORIES.map((category, index) => <React.Fragment key={category}>{index > 0 ? ' + ' : ''}{n(explanation.categories[category].subgrade)}</React.Fragment>)}) ÷ 4 = <strong>{n(explanation.overall.rawGrade)}</strong> raw calculation</p></div><div className="rr-award-equation"><span>{String(explanation.overall.rawGrade)}<small>Unrounded result</small></span><span aria-hidden="true">→</span><strong>{finalGrade}<small>ATLAS award</small></strong></div>
        <details open={printing ? true : undefined}><summary>Rounding and complete calculation</summary><p>Detailed grade, rounded to the nearest tenth: <strong>{n(explanation.overall.displayGrade)}</strong></p>
        {halfPointGrade ? <><p className="rr-awarded">Final ATLAS grade, rounded to the nearest half point: <strong>{n(finalGrade)}</strong></p><p>The final grade is rounded directly from <strong>{String(explanation.overall.rawGrade)}</strong>, with exact halfway values rounded up. The tenth-point detail is not used as a second rounding input.</p></> : <p>Original historical final grade: <strong>{n(finalGrade)}</strong>. This report retains its original tenth-point policy.</p>}
        <p>Total unrounded deduction from 10: {n(explanation.overall.rawDeductionFromTen, ' points')}</p>{explanation.policy.additionalCaps === null && <p>No additional grade cap applies in this rule.</p>}</details></div>
      <details className="rr-policy" open={printing ? true : undefined}><summary>Grading thresholds and rules</summary><p>{explanation.policy.conditionFormula}</p><p>{explanation.policy.centeringFormula}</p><p>{explanation.policy.overallFormula}</p><p>{explanation.policy.finalGradeFormula}</p><table><thead><tr><th>Weighted damage in a category</th><th>Side score</th></tr></thead><tbody>{explanation.policy.conditionBands.map((band, index) => <tr key={index}><td>{band.label}</td><td>{band.score}</td></tr>)}</tbody></table><p>Rule version: {report.ruleVersion}</p></details>
    </section>
    <section className="rr-provenance" aria-label="Report provenance"><div><p className="rr-eyebrow">A RECORD YOU CAN REVISIT</p><h2>{approved ? 'Approved evidence, preserved' : 'Your review, before approval'}</h2><p>{approved ? 'This view belongs to the saved approved report. Later work requires its own approval.' : 'Approval saves this exact report. Return to Findings or Geometry to make corrections first.'}</p></div><dl><div><dt>Status</dt><dd>{approved ? 'Human approved' : 'Draft · not approved'}</dd></div>{publication?.reportNumber && <div><dt>Report</dt><dd>{publication.reportNumber}</dd></div>}{publication?.version && <div><dt>Version</dt><dd>{publication.version}</dd></div>}{publication?.approvedAt && <div><dt>Approved</dt><dd>{publication.approvedAt.slice(0, 10)}</dd></div>}<div><dt>Rule</dt><dd>{report.ruleVersion}</dd></div><div><dt>Photographs</dt><dd>{bothReady ? 'Both saved photographs verified' : 'Awaiting image verification'}</dd></div></dl>
      <p className="rr-help">Photographs and derived inspection views are evidence of the recorded review. This report does not assert physical slab finishing or NFC completion.</p>
      {approved && <button type="button" className="rr-print-button" disabled={!bothReady} onClick={() => { if (typeof window !== 'undefined') window.print(); }}>Print approved report</button>}
      {reportKey && <details className="rr-report-reference" open={printing ? true : undefined}><summary>Exact report reference</summary><code>{reportKey}</code></details>}
    </section>
    {!publicView && <footer className="rr-approval"><h2>{approved ? 'Report approved and saved' : 'Final approval'}</h2><p>Approval saves this exact report. Return to Findings or Geometry to make corrections before approving.</p>{!bothReady && <p role="status">Both saved photographs must load and verify before approval is available.</p>}{children}</footer>}
    {publicView && children}
  </section>;
}
