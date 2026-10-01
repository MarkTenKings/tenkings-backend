import ApprovedReportTour from '../../../../packages/atlas-manual-workspace/src/ApprovedReportTour.jsx';
import { filmSelector } from '../../../../packages/atlas-report-view/src/film-selector.mjs';
export default function ReportFilmCard({card}) {
 if(!filmSelector(card?.reportUrl))return null;
 return <article className="report-film-card"><div><span className="eyebrow">Your approved report</span><h3>{card.title||card.identity?.title||'Your graded card'}</h3><p>Create a film of your saved grade and evidence.</p></div><ApprovedReportTour reportUrl={card.reportUrl}label="Create your card film"/></article>;
}
