// Browser-safe interpretation of an explicit retained source season. This does
// not resolve an unknown physical identity or infer a season from a bare year.
export function validVariantSourceSeason(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'startingYearAlias,year'
    || typeof value.startingYearAlias !== 'boolean' || typeof value.year !== 'string') return false;
  const match = /^(\d{4})-(\d{2})$/.exec(value.year);
  return Boolean(match && Number(match[2]) === (Number(match[1]) + 1) % 100);
}
export function resolveVariantSourceSeasonYear(value, season) {
  if (!validVariantSourceSeason(season) || typeof value !== 'string') return null;
  if (value === season.year || season.startingYearAlias && value === season.year.slice(0, 4)) return season.year;
  // A leading ASCII apostrophe abbreviates a two-digit printed season. The
  // explicit retained season still supplies the century and both year ends.
  const text = /^'\d{2}\s*[-\u2010-\u2015/]\s*\d{2}$/.test(value) ? value.slice(1) : value;
  const match = /^(\d{2}|\d{4})\s*[-\u2010-\u2015/]\s*(\d{2}|\d{4})$/.exec(text);
  if (!match) return null;
  const start = season.year.slice(0, 4), end = String(Number(start) + 1);
  return match[1] === (match[1].length === 2 ? start.slice(-2) : start)
    && match[2] === (match[2].length === 2 ? end.slice(-2) : end) ? season.year : null;
}
