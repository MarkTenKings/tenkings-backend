import { requireThat } from '@atlas/manual-service/contract';

export function variantReviewSettings(env) {
  if (env.ATLAS_MANUAL_VARIANT_REVIEW_ENABLED !== 'true') return null;
  requireThat(env.ATLAS_MANUAL_ENABLED === 'true' && env.ATLAS_MANUAL_DEFECT_ANALYSIS_ENABLED === 'true'
    && env.ATLAS_MANUAL_DEFECT_MEMORY_ENABLED === 'true', 503, 'VARIANT_REVIEW_CONFIGURATION');
  const catalogToken = env.ATLAS_MANUAL_CATALOG_ENABLED === 'true' ? env.ATLAS_MANUAL_CATALOG_TOKEN : null;
  requireThat(!catalogToken || /^[A-Za-z0-9_-]{43,128}$/.test(catalogToken), 503, 'VARIANT_CATALOG_CONFIGURATION');
  const scrydexEnabled = env.ATLAS_VARIANT_SCRYDEX_ENABLED === 'true';
  const scrydex = scrydexEnabled ? { apiKey: env.ATLAS_VARIANT_SCRYDEX_API_KEY, teamId: env.ATLAS_VARIANT_SCRYDEX_TEAM_ID } : null;
  requireThat(!scrydex || Object.values(scrydex).every(value => typeof value === 'string' && value.length >= 4 && value.length <= 512
    && !/[\s\x00-\x1f\x7f]/.test(value)), 503, 'SCRYDEX_NOT_CONFIGURED');
  return Object.freeze({ catalogToken, scrydex: scrydex ? Object.freeze(scrydex) : null });
}

export function variantWorkerSettings(env) {
  const review = variantReviewSettings(env);
  requireThat(review && env.ATLAS_VARIANT_WORKER_ENABLED === 'true' && !env.VERCEL && !env.AWS_LAMBDA_FUNCTION_NAME,
    503, 'VARIANT_WORKER_CONFIGURATION');
  let database, main;
  try { database = new URL(env.ATLAS_VARIANT_DATABASE_URL); main = new URL(env.ATLAS_MANUAL_DATABASE_URL); }
  catch { requireThat(false, 503, 'VARIANT_WORKER_DATABASE_CONFIGURATION'); }
  requireThat(['postgres:', 'postgresql:'].includes(database.protocol) && database.hostname === main.hostname
    && database.port === main.port && database.pathname === main.pathname && database.username && database.password && database.username !== main.username
    && database.searchParams.get('schema') === 'atlas_manual' && database.searchParams.get('connection_limit') === '1'
    && database.searchParams.get('sslmode') === main.searchParams.get('sslmode'), 503, 'VARIANT_WORKER_DATABASE_CONFIGURATION');
  const apiKey = env.ATLAS_VARIANT_OPENAI_KEY;
  requireThat(typeof apiKey === 'string' && apiKey !== env.ATLAS_MANUAL_OPENAI_KEY && apiKey.length >= 16 && apiKey.length <= 4096 && !/[\s\x00-\x1f\x7f]/.test(apiKey),
    503, 'VARIANT_PROVIDER_NOT_CONFIGURED');
  const listingsEnabled = env.ATLAS_VARIANT_LISTINGS_ENABLED === 'true';
  const listingApiKey = listingsEnabled ? env.ATLAS_VARIANT_SOLD_COMPS_API_KEY : null;
  requireThat(!listingsEnabled || typeof listingApiKey === 'string' && listingApiKey.length >= 12
    && listingApiKey.length <= 4096 && !/[\s\x00-\x1f\x7f]/.test(listingApiKey),
    503, 'VARIANT_LISTING_PROVIDER_NOT_CONFIGURED');
  // Deployment fixes one worker, one DB connection and one in-flight comparison.
  // Extra parallelism requires a new capacity qualification, not an env tweak.
  return Object.freeze({ ...review, databaseUrl: database.href, apiKey, listingApiKey, concurrency: 1, intervalMs: 5000 });
}

/** Reuse cold storage/analysis composition without granting this process the
 * ordinary serving host's unrelated worker or customer capabilities. */
export function variantWorkerEnvironment(env, settings) {
  return { ...env, ATLAS_MANUAL_DATABASE_URL: settings.databaseUrl, ATLAS_MANUAL_OPENAI_KEY: settings.apiKey,
    ATLAS_MANUAL_IDENTIFICATION_ENABLED: 'false', ATLAS_MANUAL_BATCH_ENABLED: 'false',
    ATLAS_MANUAL_PRESENTATION_ENABLED: 'false', ATLAS_MANUAL_MARKET_ENABLED: 'false',
    ATLAS_MANUAL_MARKET_AUTOMATIC_ENABLED: 'false', ATLAS_MANUAL_REPORT_IMAGES_ENABLED: 'false',
    ATLAS_MANUAL_REVIEW_DELIVERY_ENABLED: 'false',
    ATLAS_MANUAL_DEALER_OPERATIONS_ENABLED: 'false' };
}

export async function validateVariantRuntimeConfiguration({ enabled, client, worker = false }) {
  if (!enabled) return;
  const [installed] = await client.$queryRawUnsafe(`SELECT
    to_regclass('atlas_manual_connected.variant_job') IS NOT NULL AND
    to_regclass('atlas_manual_connected.variant_confirmation') IS NOT NULL AND
    to_regclass('atlas_manual_connected.variant_catalog_cache') IS NOT NULL AND
    to_regclass('atlas_manual_connected.variant_contribution') IS NOT NULL AS installed`);
  requireThat(installed?.installed === true, 503, 'VARIANT_QUEUE_SCHEMA_REQUIRED');
  const [grants] = await client.$queryRawUnsafe(`SELECT
    has_table_privilege(current_user,'atlas_manual_connected.variant_job','SELECT') AND
    has_table_privilege(current_user,'atlas_manual_connected.variant_job','INSERT') AND
    has_table_privilege(current_user,'atlas_manual_connected.variant_catalog_cache','SELECT')
    ${worker ? `AND has_table_privilege(current_user,'atlas_manual_connected.variant_catalog_cache','INSERT')
      AND has_table_privilege(current_user,'atlas_manual_connected.batch_grading','SELECT')
      AND has_table_privilege(current_user,'atlas_manual_connected.identification','SELECT')` : ''} AND
    has_table_privilege(current_user,'atlas_manual_connected.variant_confirmation','SELECT')
    ${worker ? '' : `AND has_table_privilege(current_user,'atlas_manual_connected.variant_confirmation','INSERT')`} AND
    has_table_privilege(current_user,'atlas_manual_connected.variant_contribution','SELECT')
    ${worker ? '' : `AND has_table_privilege(current_user,'atlas_manual_connected.variant_contribution','INSERT')`} AND
    has_function_privilege(current_user,'atlas_manual_connected.display_owner_version(uuid)','EXECUTE')
    ${worker ? `AND has_function_privilege(current_user,'atlas_manual_connected.display_owner_current(uuid,integer)','EXECUTE')
      AND (SELECT bool_and(has_column_privilege(current_user,'atlas_manual_connected.variant_job',c,'UPDATE')) FROM unnest(ARRAY['state','attempts','claim_id','lease_until','dispatch_id','catalog','catalog_hash','response','response_hash','result','result_hash','code','available_at','updated_at','audit']) c)
      AND (SELECT bool_and(has_column_privilege(current_user,'atlas_manual_connected.variant_contribution',c,'UPDATE')) FROM unnest(ARRAY['state','attempts','claim_id','lease_until','receipt','receipt_hash','reference_packet','reference_packet_hash','code','available_at']) c)
      AND (SELECT rolconnlimit=1 FROM pg_roles WHERE rolname=current_user)` : ''} AS allowed`);
  requireThat(grants?.allowed === true, 503, 'VARIANT_QUEUE_GRANTS_REQUIRED');
}
