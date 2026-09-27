import React, { useEffect, useRef } from 'react';

export function focusReviewTarget(key) {
  // Keys are internal constants/field names, not arbitrary selectors.
  const target = [...document.querySelectorAll('[data-review-target]')].find(node => node.dataset.reviewTarget === key);
  if (!target) return;
  const bannerHeight = document.querySelector('.mc-review-attention')?.getBoundingClientRect().height ?? 0;
  target.style.scrollMarginTop = `${bannerHeight + 24}px`;
  target.scrollIntoView({ block: 'start', behavior: 'auto' });
  (target.querySelector('input:not([type=file]),select,button:not(:disabled)') ?? target).focus?.({ preventScroll: true });
}

export default function ReviewAttention({ issues = [], identity, onSelect }) {
  const visited = useRef(new Set()), first = issues[0]?.key;
  useEffect(() => {
    if (!first || visited.current.has(identity)) return;
    const frame = requestAnimationFrame(() => { visited.current.add(identity); focusReviewTarget(first); });
    return () => cancelAnimationFrame(frame);
  }, [identity, first]);
  if (!issues.length) return null;
  return <aside className="mc-review-attention" aria-label="Items requiring review">
    <strong>Review the items highlighted in red</strong>
    <ul>{issues.map(issue => <li key={issue.key}><button type="button" onClick={() => {
      onSelect?.(issue);
      requestAnimationFrame(() => focusReviewTarget(issue.key));
    }}>{issue.message}</button></li>)}</ul>
  </aside>;
}
