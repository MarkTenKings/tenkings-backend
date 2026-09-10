// Build-time replacement for the legacy global database singleton. Original
// reusable services must use the explicitly supplied restricted client.
export * from '../.generated/database/index.js';
const fail = () => { throw new Error('ATLAS_PRIVATE_AMBIENT_DATABASE_FORBIDDEN'); };
export const prisma = new Proxy(fail, { get: fail, apply: fail, construct: fail });
