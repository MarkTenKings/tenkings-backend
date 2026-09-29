import React from 'react';
import Link from 'next/link';
import styles from './CompletionNextSteps.module.css';

/** Presentation only. Opening a tool does not print, encode or buy a search. */
export default function CompletionNextSteps({ published = false, reportHref, labelState = 'IDLE',
  labelOpen = false, onToggleLabel, marketAvailable = false, marketOpen = false, onToggleMarket, disabled = false }) {
  if (!published) return <section className={styles.panel} aria-label="Next steps after approval">
    <h2>Approval saved</h2><p>Publish the report to open its label, NFC finishing and sold comps.</p>
  </section>;
  const labelStatus = ({ LOADING: 'Loading approved label…', READY: 'Ready to open', FAILED: 'Label needs attention' })[labelState] ?? 'Open to prepare';
  return <section className={styles.panel} aria-label="Next steps after approval">
    <div className={styles.heading}><h2>Next steps</h2><p>Your report is approved. Physical finishing is separate.</p></div>
    <div className={styles.grid}>
      <article className={styles.action}><span className={styles.number} aria-hidden="true">01</span><h3>Print the label</h3>
        <p className={styles.status}>{labelStatus}</p><p>Open the approved label, then print or use your selected station.</p>
        <button type="button" disabled={disabled || !onToggleLabel} aria-expanded={labelOpen} onClick={onToggleLabel}>{labelOpen ? 'Hide label' : labelState === 'FAILED' ? 'Review label issue' : 'Open label & print'}</button>
      </article>
      <article className={styles.action}><span className={styles.number} aria-hidden="true">02</span><h3>Encode the NFC tag</h3>
        <p className={styles.status}>Check station setup</p><p>Encoding needs an enrolled Mac station and a qualified tag profile. Check setup or a saved operation.</p>
        <Link href="/station">NFC setup & status <span aria-hidden="true">↗</span></Link>
      </article>
      <article className={styles.action}><span className={styles.number} aria-hidden="true">03</span><h3>eBay sold comps</h3>
        <p className={styles.status}>{marketAvailable ? 'Search on request' : 'Search unavailable'}</p>
        <p>{marketAvailable ? 'Start a search when you need it. Review matching sales before adding them to the report.' : 'Sold-comp search is not enabled for this report. Your approved grade is saved.'}</p>
        <button type="button" disabled={disabled || !marketAvailable || !onToggleMarket} aria-expanded={marketOpen && marketAvailable} onClick={onToggleMarket}>{marketOpen && marketAvailable ? 'Hide sold comps' : 'Review sold comps'}</button>
      </article>
      <article className={styles.action}><span className={styles.number} aria-hidden="true">04</span><h3>Open the report</h3>
        <p className={styles.status}>Published report</p><p>See the saved photographs, reviewed findings and approved grade.</p>
        {reportHref ? <a href={reportHref} target="_blank" rel="noopener noreferrer">View customer report <span aria-hidden="true">↗</span></a> : <span className={styles.status}>Report link unavailable</span>}
      </article>
    </div>
  </section>;
}
