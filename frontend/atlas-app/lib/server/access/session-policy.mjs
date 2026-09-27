// A fixed non-expiring marker keeps the existing NOT NULL timestamp contract
// compatible with every SQL authorization boundary. It is not a rolling lease:
// new staff sessions remain valid until logout, revocation or a release change.
// Legacy rows retain their original expiry and are never upgraded in place.
export const PERSISTENT_STAFF_EXPIRY = '9999-12-31T23:59:59.999Z';

// Browsers cap persistent cookies. Refresh this storage lifetime on a valid
// session bootstrap; it is independent of server-side authorization lifetime.
export const STAFF_COOKIE_MAX_AGE = 400 * 24 * 60 * 60;
