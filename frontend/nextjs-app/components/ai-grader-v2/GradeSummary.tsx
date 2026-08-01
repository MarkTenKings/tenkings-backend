import type { calculateSpeedsterGrade } from "../../lib/ai-grader-v2/scoring";
import styles from "./GradeSummary.module.css";

type Grade = ReturnType<typeof calculateSpeedsterGrade>;
type SubgradeKey = keyof Grade["subgrades"];

type GradeSummaryProps = {
  grade: Grade;
};

const SUBGRADES: readonly { key: SubgradeKey; label: string }[] = [
  { key: "centering", label: "Centering" },
  { key: "corners", label: "Corners" },
  { key: "edges", label: "Edges" },
  { key: "surface", label: "Surface" },
];

const score = (value: number) => value.toFixed(2);
const ratio = (value: readonly [number, number]) =>
  `${value[0].toFixed(1)} / ${value[1].toFixed(1)}`;

export function GradeSummary({ grade }: GradeSummaryProps) {
  return (
    <section className={styles.summary} aria-label="Ten Kings grade summary">
      <header className={styles.overall}>
        <div><span>OVERALL GRADE</span><small>4 SUBGRADES · 25% EACH</small></div>
        <strong>{grade.overall.displayGrade.toFixed(1)}</strong>
      </header>

      <div className={styles.rows}>
        {SUBGRADES.map(({ key, label }, index) => {
          const front = grade.front[key];
          const back = grade.back[key];
          return (
            <article className={styles.row} key={key}>
              <header>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <h2>{label}</h2>
                <small>25%</small>
                <strong>{score(grade.subgrades[key])}</strong>
              </header>

              <div className={styles.equation}>
                <span>F {score(front.score)} × 70%</span>
                <i>+</i>
                <span>B {score(back.score)} × 30%</span>
                <i>=</i>
                <b>{score(grade.subgrades[key])}</b>
              </div>

              {key === "centering" ? (
                <div className={styles.evidence}>
                  <span>FRONT · L/R {ratio(grade.front.centering.leftRightBalance)} · T/B {ratio(grade.front.centering.topBottomBalance)}</span>
                  <span>BACK · L/R {ratio(grade.back.centering.leftRightBalance)} · T/B {ratio(grade.back.centering.topBottomBalance)}</span>
                </div>
              ) : (
                <div className={styles.evidence}>
                  <span>FRONT · {grade.front[key].weightedDamagePercent.toFixed(3)}% WEIGHTED DAMAGE</span>
                  <span>BACK · {grade.back[key].weightedDamagePercent.toFixed(3)}% WEIGHTED DAMAGE</span>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

export type { GradeSummaryProps };
