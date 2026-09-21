import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ReportInspectionImage } from './ReportInspectionImage.jsx';
import { reportAwardedGrade, reportImagesMatch } from './report-review-ui.mjs';

const SIDES = ['FRONT', 'BACK'];
const CATEGORIES = ['centering', 'corners', 'edges', 'surface'];
const words = value => String(value ?? '').toLowerCase().replaceAll('_', ' ');
const title = value => words(value).replace(/^./, letter => letter.toUpperCase());
function NumberValue({ value, unit = '' }) {
  if (!Number.isFinite(value)) return <>Unavailable</>;
  return <><data value={value} title={String(value)}>{value !== 0 && Math.abs(value) < 1e-12 ? value.toExponential(5) : value.toLocaleString('en-US', { maximumFractionDigits: 12 })}</data>{unit}</>;
}
const n = (value, unit) => <NumberValue value={value} unit={unit}/>;

function FindingCalculation({ finding, explanation, policy }) {
  return <section className="rr-finding-detail" aria-label="Selected finding calculation">
    <div className="rr-section-heading"><div><p className="rr-eyebrow">SELECTED FINDING · {title(finding.side)}</p><h3>{title(finding.defectType)}</h3></div><span className="rr-badge">{explanation.included ? 'Included in grade' : 'Removed · excluded'}</span></div>
    <p>{explanation.included ? 'Saved trace for this finding. Measured area excludes pixels outside the card material and overlapping pixels assigned to another finding.' : 'This finding remains in the review history and contributes no damage or deduction.'}</p>
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
    <p className="rr-help">Marginal effects compare the grade with and without one measured region; overlap ownership is not remeasured. These effects are not additive. The category calculation uses all included weighted damage together. Hover a number to see its full stored precision.</p>
  </section>;
}

function CategoryCalculation({ category, explanation }) {
  const result = explanation.categories[category], policy = explanation.policy;
  return <article className="rr-category"><header><h3>{title(category)}</h3><strong>{n(result.subgrade)}</strong></header>
    {SIDES.map(side => {
      const value = explanation.sides[side][category === 'centering' ? category : category.toUpperCase()];
      return <section key={side}><h4>{title(side)} <span>{n(value.score)} / 10</span></h4>
        {category === 'centering' ? <><p>Left / right: {n(value.leftRightBalance[0])} / {n(value.leftRightBalance[1])}</p><p>Top / bottom: {n(value.topBottomBalance[0])} / {n(value.topBottomBalance[1])}</p><p>Largest border share: {n(value.worstPercent, '%')}</p><p>Grade-10 limit: {n(policy.centering.toleranceWorstPercent, '%')} on either border. {value.withinTenTolerance ? 'Within tolerance.' : 'Outside tolerance; see the centering rule below.'}</p></> : <><p>Included damage: {n(value.rawAreaMm2, ' mm²')}</p><p>Weighted damage: {n(value.weightedAreaMm2, ' mm²')}{value.eligibleAreaMm2 !== null ? <> ÷ {n(value.eligibleAreaMm2, ' mm²')} × 100 = <strong>{n(value.weightedDamagePercent, '%')}</strong></> : <>. Category damage: <strong>{n(value.weightedDamagePercent, '%')}</strong>; no included measured area.</>}</p>
          {value.tenBandMaxWeightedAreaMm2 !== null && <p>Grade-10 allowance: {n(value.tenBandMaxWeightedAreaMm2, ' weighted mm²')}</p>}
          <p>Deduction from 10: {n(value.deductionFromTen, ' points')}</p></>}
      </section>;
    })}
    <p className="rr-category-total">{n(result.frontScore)} × {n(policy.frontWeight)} + {n(result.backScore)} × {n(policy.backWeight)} = <strong>{n(result.subgrade)}</strong></p>
    <p>Overall contribution: {n(result.subgrade)} × {n(policy.categoryWeight)} = {n(result.overallContribution)}</p>
  </article>;
}

/** Verified persisted report + core-owned explanation; no grading or approval is performed here. */
export function FinalReportReview({ preview, workspace, images, current = true, approved = false, rejectedSuggestions = 0, onReadyChange, children }) {
  const report = preview?.review?.report, explanation = preview?.review?.explanation;
  const finalGrade = reportAwardedGrade(report), halfPointGrade = report?.version === 'atlas-manual-draft-report-v2';
  const available = Boolean(current && reportImagesMatch(report, workspace) && explanation?.ruleVersion === report.ruleVersion
    && explanation?.policy && explanation?.categories && explanation?.sides && explanation.overall?.finalGrade === finalGrade && Array.isArray(explanation.findings)
    && report.findings.length === explanation.findings.length && report.findings.every(finding => explanation.findings.some(value => value.id === finding.id && value.side === finding.side)));
  const [selected, setSelected] = useState(null), [expanded, setExpanded] = useState(null), [ready, setReady] = useState({});
  const sideFindings = useMemo(() => Object.fromEntries(SIDES.map(side => [side, report?.findings?.filter(finding => finding.side === side) ?? []])), [report]);
  const imageReady = useCallback((side, value) => setReady(previous => previous[side] === value ? previous : { ...previous, [side]: value }), []);
  const bothReady = available && SIDES.every(side => ready[side]);
  useEffect(() => { onReadyChange?.(bothReady); return () => onReadyChange?.(false); }, [bothReady, onReadyChange]);
  const selectedFinding = report?.findings?.find(finding => finding.id === selected?.id);
  const selectedExplanation = explanation?.findings?.find(finding => finding.id === selected?.id);
  const select = finding => { setSelected(previous => ({ id: finding.id, sequence: (previous?.sequence ?? 0) + 1 })); if (expanded && expanded !== finding.side) setExpanded(finding.side); };
  if (!available) return <section className="rr-report" aria-label="Final draft review unavailable"><h1>Review draft report</h1><p role="alert">The full report does not match the current saved review. Return to Findings and open the draft report again.</p></section>;
  return <section className="rr-report" aria-label="Final draft report review">
    <header className="rr-heading"><div><p className="rr-eyebrow">ATLAS · FINAL HUMAN REVIEW</p><h1>{approved ? 'Review approved report' : 'Review draft report'}</h1><p>{Object.values(report.identity).filter(value => typeof value === 'string' && value).join(' · ')}</p><p>{report.findingCounts.included} included findings · {report.findingCounts.removed} removed findings · {rejectedSuggestions} rejected suggestions</p></div><div className="rr-overall"><span>{approved ? 'APPROVED GRADE' : 'DRAFT GRADE'}</span><strong>{finalGrade}</strong><span>{!halfPointGrade ? 'Original historical grade' : approved ? 'Approved and saved' : 'Awaiting separate approval'}</span></div></header>
    <div className="rr-score-strip">{CATEGORIES.map(category => <div key={category}><span>{title(category)}</span><strong>{n(report.grade.subgrades[category])}</strong></div>)}</div>
    <section className="rr-photo-review" aria-label="Report photographs and findings"><div className="rr-section-heading"><div><h2>Inspect the confirmed findings</h2><p>Select a finding on either photograph to focus it and see its exact calculation.</p></div>{expanded && <div className="rr-side-switch">{SIDES.map(side => <button key={side} type="button" aria-pressed={expanded === side} onClick={() => setExpanded(side)}>{title(side)}</button>)}</div>}</div>
      <div className={`rr-image-pair${expanded ? ' rr-pair-expanded' : ''}`}>{SIDES.map(side => <ReportInspectionImage key={`${side}:${report.inspection[side.toLowerCase()].imageSha256}`} side={side} descriptor={images?.[side]?.inspection} expectedHash={report.inspection[side.toLowerCase()].imageSha256} findings={sideFindings[side]} selected={selected} onSelect={select} expanded={expanded === side} hidden={Boolean(expanded && expanded !== side)} onExpand={setExpanded} onReady={imageReady}/>)}</div>
      {selectedFinding && selectedExplanation ? <FindingCalculation finding={selectedFinding} explanation={selectedExplanation} policy={explanation.policy}/> : <p className="rr-selection-prompt">{report.findingCounts.included ? 'Choose a finding above to inspect its saved trace, measurements and grade effect.' : 'There are no included findings. The grade below also accounts for the confirmed centering on both sides.'}</p>}
      {report.findingCounts.removed > 0 && <details className="rr-removed"><summary>Removed findings · {report.findingCounts.removed}</summary><p>Retained in review history; excluded from the grade.</p>{report.findings.filter(finding => finding.reviewResult === 'REMOVED').map(finding => <button key={finding.id} type="button" onClick={() => select(finding)}>{title(finding.side)} · {words(finding.defectType)}</button>)}</details>}
    </section>
    <section className="rr-calculation" aria-label="Grade calculation"><h2>How this grade is calculated</h2>
      {finalGrade === 10 && report.findingCounts.included > 0 && <p className="rr-tolerance-note">A final 10 can include measured damage. The category thresholds and final rounding below show how this result was reached.</p>}
      <p>Front contributes {n(explanation.policy.frontWeight * 100, '%')}; Back contributes {n(explanation.policy.backWeight * 100, '%')}. Each of the four categories contributes {n(explanation.policy.categoryWeight * 100, '%')} of the overall grade.</p>
      <div className="rr-category-grid">{CATEGORIES.map(category => <CategoryCalculation key={category} category={category} explanation={explanation}/>)}</div>
      <div className="rr-final-math"><h3>Overall grade</h3><p>({CATEGORIES.map((category, index) => <React.Fragment key={category}>{index > 0 ? ' + ' : ''}{n(explanation.categories[category].subgrade)}</React.Fragment>)}) ÷ 4 = <strong>{n(explanation.overall.rawGrade)}</strong> raw calculation</p><p>Detailed grade, rounded to the nearest tenth: <strong>{n(explanation.overall.displayGrade)}</strong></p>
        {halfPointGrade ? <><p className="rr-awarded">Final ATLAS grade, rounded to the nearest half point: <strong>{n(finalGrade)}</strong></p><p>The final grade is rounded directly from {n(explanation.overall.rawGrade)}, with exact halfway values rounded up. The tenth-point detail is not used as a second rounding input.</p></> : <p>Original historical final grade: <strong>{n(finalGrade)}</strong>. This report retains its original tenth-point policy.</p>}
        <p>Total unrounded deduction from 10: {n(explanation.overall.rawDeductionFromTen, ' points')}</p>{explanation.policy.additionalCaps === null && <p>No additional grade cap applies in this rule.</p>}</div>
      <details className="rr-policy"><summary>Grading thresholds and rules</summary><p>{explanation.policy.conditionFormula}</p><p>{explanation.policy.centeringFormula}</p><p>{explanation.policy.overallFormula}</p><p>{explanation.policy.finalGradeFormula}</p><table><thead><tr><th>Weighted damage in a category</th><th>Side score</th></tr></thead><tbody>{explanation.policy.conditionBands.map((band, index) => <tr key={index}><td>{band.label}</td><td>{band.score}</td></tr>)}</tbody></table><p>Rule version: {report.ruleVersion}</p></details>
    </section>
    <footer className="rr-approval"><h2>Final approval</h2><p>Approval saves this exact report. Return to Findings or Geometry to make corrections before approving.</p>{!bothReady && <p role="status">Both saved photographs must load and verify before approval is available.</p>}{children}</footer>
  </section>;
}
