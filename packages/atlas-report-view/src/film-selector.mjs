export function filmSelector(reportUrl) {
  if (typeof reportUrl !== 'string') return null;
  const match = /^\/reports\/(ar_[A-Za-z0-9_-]{24})\?v=([1-9][0-9]{0,9})$/.exec(reportUrl);
  if (!match || Number(match[2]) > 2147483647) return null;
  return { token: match[1], version: Number(match[2]), url: `/api/reports/${match[1]}/film?v=${match[2]}` };
}
