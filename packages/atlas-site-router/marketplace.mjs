import { routeTarget } from './routes.mjs';

const mounts = Object.freeze({ public: '/marketplace', staff: '/admin/marketplace', customer: '/account/marketplace' });

// The existing edge router owns raw forwarding. These origins are separate
// owned-host ingress, never replacement canonical auth/deployment identities.
export function marketplaceForwarding(target, env) {
    const route = routeTarget(target), path = target.split('?')[0], mount = mounts[route.zone];
    const logout = route.zone === 'staff' ? '/admin/api/staff/auth/logout' : route.zone === 'customer' ? '/account/api/customer/auth/logout' : null;
    if (path !== mount && !path.startsWith(`${mount}/`) && path !== logout) return null;
    if (env.ATLAS_MARKETPLACE_ENABLED === undefined) return null;
    if (env.ATLAS_MARKETPLACE_ENABLED !== '1') throw new Error('MARKETPLACE_ROUTING_DISABLED');
    const value = env[`ATLAS_MARKETPLACE_${route.zone.toUpperCase()}_ORIGIN`];
    let origin;
    try { origin = new URL(value); } catch { throw new Error('MARKETPLACE_INGRESS_REQUIRED'); }
    if (origin.origin !== value || origin.protocol !== 'https:' || origin.port
        || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.atlasgrading\.com$/.test(origin.hostname)
        || origin.username || origin.password) throw new Error('MARKETPLACE_INGRESS_REQUIRED');
    return Object.freeze({ zone: route.zone, origin: origin.origin, target });
}
