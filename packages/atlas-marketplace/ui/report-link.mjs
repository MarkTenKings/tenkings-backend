// R1's immutable browser report route. The version must be the retained card's
// exact revision. This is a display link, never title, custody or sale authority.
export function approvedReportPath(value,version) {
  if(typeof value!=='string'||!Number.isSafeInteger(version)||version<=0||version>=2147483647)return null;
  const match=/^\/reports\/(ar_[A-Za-z0-9_-]{24})\?v=([1-9][0-9]*)$/.exec(value);
  return match&&match[2]===String(version)?value:null;
}
