export const GRADE_STORY_CATEGORIES = ['centering', 'corners', 'edges', 'surface'];
export const GRADE_STORY_DURATION = 7000;
const clamp = value => Math.max(0, Math.min(1, value));
const close = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-8;

/** Display model only. The verified, persisted explanation remains authoritative. */
export function gradeStoryModel(explanation) {
  const { policy, categories, overall } = explanation ?? {};
  if (!policy || !categories || !overall) return null;
  const raw = overall.rawGrade, final = overall.finalGrade, weight = policy.categoryWeight;
  if (![raw, final, weight, policy.frontWeight, policy.backWeight].every(Number.isFinite)
    || raw < 1 || raw > 10 || final < 1 || final > 10 || !close(weight * 4, 1)
    || !close(policy.frontWeight + policy.backWeight, 1)) return null;
  const rows = GRADE_STORY_CATEGORIES.map(key => {
    const value = categories[key];
    if (!value || ![value.subgrade, value.frontScore, value.backScore, value.deductionFromTen, value.overallContribution].every(Number.isFinite)
      || value.subgrade < 1 || value.subgrade > 10
      || !close(value.frontScore * policy.frontWeight + value.backScore * policy.backWeight, value.subgrade)
      || !close(10 - value.subgrade, value.deductionFromTen)
      || !close(value.subgrade * weight, value.overallContribution)) return null;
    return { key, label: key[0].toUpperCase() + key.slice(1), score: value.subgrade,
      front: value.frontScore, back: value.backScore, weight,
      deduction: value.deductionFromTen * weight };
  });
  if (rows.some(row => !row) || !close(rows.reduce((sum, row) => sum + row.score * weight, 0), raw)
    || !close(overall.rawDeductionFromTen, 10 - raw)) return null;
  const minimum = Math.max(1, Math.min(9, Math.floor(Math.min(raw, final))));
  const maximum = Math.min(10, Math.max(minimum + 1, Math.ceil(Math.max(raw, final))));
  return { rows, raw, final, deduction: overall.rawDeductionFromTen, minimum, maximum,
    frontWeight: policy.frontWeight, backWeight: policy.backWeight,
    rounding: policy.finalGradeFormula, direction: final > raw ? 'up' : final < raw ? 'down' : 'unchanged' };
}

/** Shared deterministic timeline; no score is recalculated by the animation. */
export function gradeStoryFrame(model, elapsed) {
  const t = Math.max(0, Math.min(GRADE_STORY_DURATION, elapsed));
  const travel = clamp((t - 2600) / 2600), rounding = clamp((t - 6000) / 600);
  const position = t < 6000 ? model.minimum + (model.raw - model.minimum) * (1 - (1 - travel) ** 4)
    : model.raw + (model.final - model.raw) * (1 - (1 - rounding) ** 3);
  const phase = t < 2000 ? `Reviewing ${model.rows[Math.min(3, Math.floor(t / 500))].label.toLowerCase()}`
    : t < 2600 ? 'Combining category deductions'
      : t < 5200 ? 'Approaching the calculated score'
        : t < 6000 ? `Calculated score ${model.raw} · before rounding`
          : t < 6600 ? model.direction === 'unchanged' ? 'The calculated score already matches the final grade' : `Applying the saved rounding rule · ${model.direction}`
            : `Final grade ${model.final} · calculation complete`;
  return { position, phase, rows: t >= 2000 ? 4 : Math.min(4, Math.floor(t / 500) + 1),
    math: t >= 2000, scale: t >= 2600, raw: t >= 5200, final: t >= 6600,
    lift: model.direction !== 'unchanged' && t >= 6000 && t < 6600 ? 8 * Math.sin(Math.PI * rounding) : 0,
    complete: t >= GRADE_STORY_DURATION };
}
