import { useState } from 'react';

const labels = { centering: 'Centering', corners: 'Corners', edges: 'Edges', surface: 'Surface' };
const words = value => value.replaceAll('_', ' ').toLowerCase();
const score = value => value.toFixed(2);
const ratio = value => value.map(v => v.toFixed(1)).join(' / ');

/** Presentation only. The server supplies a verified, explicitly projected report. */
export default function GradedReport({ report, approved = false, synthetic = false, children }) {
    const [limit, setLimit] = useState(30);
    const grade = report.grade;
    return <section className="graded-report" aria-label="ATLAS graded report">
        <div className="report-heading"><div><p className="eyebrow">ATLAS GRADED REPORT</p><h2>{approved ? 'Human-approved grade' : 'Grade awaiting human approval'}</h2>
            <p>{synthetic ? 'Demonstration only · No card detection or Astra run' : 'Calculated from confirmed centering and measured findings'}</p></div>
            <div className="overall-grade"><span>OVERALL</span><strong>{grade.overall.displayGrade.toFixed(1)}</strong></div></div>
        <div className="grade-grid">{Object.entries(labels).map(([key, label]) => <article key={key}>
            <div><h3>{label}</h3><strong>{score(grade.subgrades[key])}</strong></div>
            <p>Front {score(grade.front[key].score)} × 70%<br/>Back {score(grade.back[key].score)} × 30%</p>
            <small>25% of overall grade</small>
        </article>)}</div>
        <details className="grade-details"><summary>Centering and measured findings <span>{report.findings.length}</span></summary>
            <div className="centering-detail">{['front', 'back'].map(side => <p key={side}><strong>{words(side)}</strong> · Left / right {ratio(grade[side].centering.leftRightBalance)} · Top / bottom {ratio(grade[side].centering.topBottomBalance)}</p>)}</div>
            {report.findings.length ? <ol className="finding-list">{report.findings.slice(0, limit).map(finding => <li key={finding.id}>
                <div><strong>{words(finding.defectType)}</strong><span>{words(finding.side)} · {words(finding.reviewResult)}</span></div>
                <ul>{(finding.measurementRegions ?? [{ zone: finding.zone, measurement: finding.measurement }]).map((region, index) => <li key={index}>{words(region.zone)} · {region.measurement.areaMm2.toFixed(3)} mm² · {region.measurement.weightedAreaMm2.toFixed(3)} mm² weighted</li>)}</ul>
            </li>)}</ol> : <p className="report-empty">No included findings in this report.</p>}
            {limit < report.findings.length && <button className="text-button" onClick={() => setLimit(n => n + 30)}>Show more findings</button>}
        </details>
        {children}
    </section>;
}
