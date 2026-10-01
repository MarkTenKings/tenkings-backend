import ReportFilmCard from './ReportFilmCard.jsx';
import { filmSelector } from '../../../../packages/atlas-report-view/src/film-selector.mjs';
/** cards must come from the authenticated customer's existing server projection. */
export default function ReportFilmLibrary({cards=[]}) {
 const unique=[...new Map(cards.filter(card=>filmSelector(card?.reportUrl)).map(card=>[card.reportUrl,card])).values()];
 if(!unique.length)return null;
 return <section className="report-film-library"aria-label="Your card films"><div className="section-heading compact"><div><span className="eyebrow">Made from your approved evidence</span><h2>Your card. Its story.</h2><p>A short film to save and share.</p></div></div><div className="report-film-grid">{unique.map(card=><ReportFilmCard key={card.reportUrl}card={card}/>)}</div></section>;
}
