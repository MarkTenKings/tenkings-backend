import { useEffect, useState } from 'react';
import { captureCardDetailReportEntry, readCardDetailReportEntry } from '@atlas/site-router/report-entry';
import styles from './ReportEntryNavigation.module.css';

// Next loads this page module before constructing its router and replacing the
// current history state. An effect would run too late to preserve reload entry.
captureCardDetailReportEntry();

// Host navigation is deliberately outside the immutable approved report view.
export default function ReportEntryNavigation({ reportPath }) {
  const [entry, setEntry] = useState(null);
  useEffect(() => {
    const refresh = () => setEntry({ reportPath, cardPath: readCardDetailReportEntry(reportPath) });
    refresh();
    window.addEventListener('pageshow', refresh);
    return () => window.removeEventListener('pageshow', refresh);
  }, [reportPath]);
  if (entry?.reportPath !== reportPath || !entry?.cardPath) return null;
  return <nav className={styles.navigation} aria-label="Report navigation">
    <a href={entry.cardPath} referrerPolicy="no-referrer" rel="noreferrer"><span aria-hidden="true">←</span> Card Detail</a>
  </nav>;
}
