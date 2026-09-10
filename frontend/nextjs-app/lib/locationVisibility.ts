/** HQ is operational space, not a customer destination, even if its status is later edited. */
export function isInternalLocation(location: { locationType?: string | null; locationStatus?: string | null }) {
  return location.locationType?.trim().toLowerCase() === 'hq' || location.locationStatus?.trim().toLowerCase() === 'internal';
}

export const publicLocationWhere = {
  AND: [
    { OR: [{ locationType: null }, { locationType: { not: 'hq' } }] },
    { OR: [{ locationStatus: null }, { locationStatus: { not: 'internal' } }] },
  ],
};
