import { requireThat } from '@atlas/manual-service/contract';

export function orderDeskPhotoSettings(env) {
  if (env.ATLAS_MANUAL_DEALER_OPERATIONS_ENABLED !== 'true' || env.ATLAS_CUSTOMER_INTAKE_ENABLED !== 'true') return null;
  const check = value => requireThat(value, 503, 'ORDER_DESK_PHOTO_CONFIGURATION_INVALID');
  let endpoint;
  try { endpoint = new URL(env.ATLAS_CUSTOMER_STORAGE_ENDPOINT); } catch { check(false); }
  check(endpoint.protocol === 'https:' && !endpoint.username && !endpoint.password && endpoint.pathname === '/' && !endpoint.search && !endpoint.hash);
  check(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(env.ATLAS_CUSTOMER_STORAGE_BUCKET ?? '')
    && /^[a-z0-9-]{1,40}$/.test(env.ATLAS_CUSTOMER_STORAGE_REGION ?? '')
    && typeof env.ATLAS_CUSTOMER_STORAGE_ACCESS_KEY === 'string' && env.ATLAS_CUSTOMER_STORAGE_ACCESS_KEY.length >= 8
    && typeof env.ATLAS_CUSTOMER_STORAGE_SECRET_KEY === 'string' && env.ATLAS_CUSTOMER_STORAGE_SECRET_KEY.length >= 16);
  return { endpoint: endpoint.origin, bucket: env.ATLAS_CUSTOMER_STORAGE_BUCKET, region: env.ATLAS_CUSTOMER_STORAGE_REGION };
}

export async function validateOrderDeskConfiguration({ enabled, client }) {
  if (!enabled) return;
  const [schema] = await client.$queryRawUnsafe("SELECT to_regprocedure('atlas_dealer.order_desk_call(text,text,text,jsonb,text[],jsonb)') IS NOT NULL AND to_regprocedure('atlas_dealer.staff_order_acknowledge(text,text,jsonb,text[],jsonb)') IS NOT NULL AS installed");
  requireThat(schema?.installed === true, 503, 'ORDER_DESK_SCHEMA_REQUIRED');
  const [grants] = await client.$queryRawUnsafe("SELECT has_function_privilege(current_user,'atlas_dealer.order_desk_call(text,text,text,jsonb,text[],jsonb)','EXECUTE') AND has_function_privilege(current_user,'atlas_dealer.staff_order_acknowledge(text,text,jsonb,text[],jsonb)','EXECUTE') AS allowed");
  requireThat(grants?.allowed === true, 503, 'ORDER_DESK_GRANTS_REQUIRED');
}
