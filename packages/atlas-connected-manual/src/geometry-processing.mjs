import { requireThat } from '@atlas/manual-service/contract';

export const GEOMETRY_MAX_CONCURRENCY = 12;
export const GEOMETRY_MAX_DISCOVERY_PAGE_SIZE = 32;

/** Explicit deployment settings, never derived from host CPU count. Raising
 * concurrency requires memory/throughput qualification of that worker host. */
export function geometryProcessingSettings({ geometryConcurrency = 2, geometryDiscoveryPageSize = 2 } = {}) {
  requireThat(Number.isInteger(geometryConcurrency) && geometryConcurrency >= 1 && geometryConcurrency <= GEOMETRY_MAX_CONCURRENCY
    && Number.isInteger(geometryDiscoveryPageSize) && geometryDiscoveryPageSize >= 1
    && geometryDiscoveryPageSize <= GEOMETRY_MAX_DISCOVERY_PAGE_SIZE, 503, 'GEOMETRY_PROCESSING_CONFIG_INVALID');
  return Object.freeze({ geometryConcurrency, geometryDiscoveryPageSize });
}

export function geometryProcessingEnvironment(env) {
  return geometryProcessingSettings({
    geometryConcurrency: env.ATLAS_MANUAL_GEOMETRY_CONCURRENCY === undefined ? 2 : Number(env.ATLAS_MANUAL_GEOMETRY_CONCURRENCY),
    geometryDiscoveryPageSize: env.ATLAS_MANUAL_GEOMETRY_DISCOVERY_PAGE_SIZE === undefined ? 2 : Number(env.ATLAS_MANUAL_GEOMETRY_DISCOVERY_PAGE_SIZE),
  });
}
