import type { NextApiRequest, NextApiResponse } from 'next';
import { prisma } from '@tenkings/database';
import { requireInventoryAdminSession } from '../../../../../lib/server/inventoryAdmin';
import { geocodeLocationAddress } from '../../../../../lib/server/locationGeocoding';
import { ONLINE_LOCATION_SLUG } from '../../../../../lib/locationUtils';

type Location = { id: string; slug: string; address: string | null; latitude: number | null; longitude: number | null };
const validPoint = (point: { latitude: number | null; longitude: number | null }) =>
  typeof point.latitude === 'number' && Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90 &&
  typeof point.longitude === 'number' && Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180;

/** Resolve only an existing staff location. No public location edits or financial writes. */
export function createInventoryLocationMapHandler(deps: {
  requireAdmin: typeof requireInventoryAdminSession;
  readLocation(id: string): Promise<Location | null>;
  geocode: typeof geocodeLocationAddress;
}) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    try {
      await deps.requireAdmin(req);
      if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return res.status(405).json({ message: 'Method not allowed.' }); }
      const id = req.query.location_id;
      if (Object.keys(req.query).length !== 1 || typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        return res.status(400).json({ message: 'Choose an existing location.' });
      }
      const location = await deps.readLocation(id);
      if (!location) return res.status(404).json({ message: 'Location not found.' });
      if (location.slug === ONLINE_LOCATION_SLUG) return res.status(200).json({ location_id: id, point: null, message: 'Online location has no map point.' });
      if (validPoint(location)) return res.status(200).json({ location_id: id, point: { latitude: location.latitude, longitude: location.longitude, coordinateSource: 'saved' } });
      if (!location.address?.trim()) return res.status(200).json({ location_id: id, point: null, message: 'Add a street address to place this location on the map.' });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const match = await deps.geocode(location.address, { signal: controller.signal, requireCompleteMatch: true });
        if (!match || !validPoint(match)) return res.status(200).json({ location_id: id, point: null, message: 'Map point unavailable. Check the saved address or try again.' });
        return res.status(200).json({ location_id: id, point: { latitude: match.latitude, longitude: match.longitude, coordinateSource: 'address_lookup' } });
      } finally { clearTimeout(timer); }
    } catch (error) {
      const status = error && typeof error === 'object' && 'statusCode' in error && (error.statusCode === 401 || error.statusCode === 403) ? error.statusCode : 503;
      return res.status(status).json({ message: status === 401 ? 'Sign in to view the inventory map.' : status === 403 ? 'Inventory access is required.' : 'Map point unavailable. Please try again.' });
    }
  };
}

export default createInventoryLocationMapHandler({
  requireAdmin: requireInventoryAdminSession,
  readLocation: id => prisma.location.findUnique({ where: { id }, select: { id: true, slug: true, address: true, latitude: true, longitude: true } }),
  geocode: geocodeLocationAddress,
});
