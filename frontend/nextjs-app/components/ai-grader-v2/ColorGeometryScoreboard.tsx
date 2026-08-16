import type { SpeedsterColorGeometryScore } from "../../lib/ai-grader-v2/color-geometry-score";
import styles from "./CaptureWorkspace.module.css";

const percentage = (value: number | null) => value === null ? "—" : `${(value * 100).toFixed(1)}%`;
const identityName = (identity: unknown) => {
  if (!identity || typeof identity !== "object" || Array.isArray(identity)) return "Unknown card";
  const candidate = identity as Record<string, unknown>;
  return [candidate.cardName ?? candidate.playerName, candidate.year, candidate.productSet]
    .filter((value) => typeof value === "string" && value)
    .join(" · ") || "Unknown card";
};

export function ColorGeometryScoreboard({ score }: Readonly<{ score: SpeedsterColorGeometryScore | null }>) {
  if (!score) return null;
  return (
    <details className={styles.colorScore}>
      <summary>
        COLOR RUNNING SCORE · AGREEMENT {percentage(score.proposalAgreementRate)} · FIRST-DRAFT YIELD {percentage(score.firstDraftYieldRate)} · COVERAGE {percentage(score.proposalCoverageRate)}
      </summary>
      <div className={styles.colorScoreBody}>
        <p>{score.acceptedUnchanged} accepted unchanged · {score.correctedAccepted} corrected · {score.manualFallbacks} manual fallbacks</p>
        <table>
          <thead><tr><th>Side / mat</th><th>Agreement</th><th>Coverage</th><th>Fallback</th></tr></thead>
          <tbody>{score.breakdown.map((row) => (
            <tr key={`${row.side}:${row.matColor}`}>
              <td>{row.side} · {row.matColor}</td>
              <td>{row.acceptedUnchanged}/{row.accepted} · {percentage(row.proposalAgreementRate)}</td>
              <td>{row.accepted}/{row.total} · {percentage(row.proposalCoverageRate)}</td>
              <td>{row.manualFallbacks}</td>
            </tr>
          ))}</tbody>
        </table>
        <div className={styles.colorDrilldown}>
          {score.recentCards.map((card) => (
            <details key={card.sessionId}>
              <summary>{identityName(card.identity)} · {card.sessionId}</summary>
              <ul>{card.results.map((result) => (
                <li key={`${result.side}:${result.mode}`}>
                  {result.side} {result.mode} · {result.matColor} · {result.outcome}
                  {result.proposalChanged === true ? " · corrected" : result.proposalChanged === false ? " · confirmed" : " · manual"}
                </li>
              ))}</ul>
            </details>
          ))}
        </div>
      </div>
    </details>
  );
}
