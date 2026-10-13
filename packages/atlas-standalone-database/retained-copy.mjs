import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const policy = JSON.parse(await readFile(new URL('./retained-copy-policy.json', import.meta.url)));
const manifest = JSON.parse(await readFile(new URL('./baseline.manifest.json', import.meta.url)));
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}' : JSON.stringify(value);
export const retainedCopyHash = value => createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
const quoted = relation => relation.split('.').map(v => { assert.match(v, /^[A-Za-z_]+$/); return '"' + v + '"'; }).join('.');
const exact = Object.values(policy.retainExact).flat().sort();
const controls = policy.rebindDisabledThenReview;
const exported = [...exact, ...controls].sort();
const zeroSource = [...policy.physicalCardOrDerivativeMustBeEmpty, ...policy.learningMustBeginEmpty];
const neutralManifest = JSON.stringify({ kind: 'EMPTY_BASELINE', policy: 'balanced-defect-v1', version: 'atlas-learning-release-v1', evaluation: null, publications: [] });

// This order follows the retained foreign keys. No card or session table is an input.
const order = [
  'atlas_staff.StaffIdentity', 'atlas_staff.StaffOperationsGrant',
  'atlas_customer.CustomerAccount', 'atlas_customer.CustomerVerifiedEmail',
  'atlas_customer.ProgressPreference', 'atlas_customer.ProgressPreferenceEvent',
  'atlas_dealer.location', 'atlas_dealer.location_revision', 'atlas_dealer.membership',
  'atlas_customer.CustomerIntakeDraft', 'atlas_customer.CommerceQuote', 'atlas_customer.CommercePayment',
  'atlas_customer.CommerceOrder', 'atlas_customer.CommerceEffect', 'atlas_customer.CommerceProviderEvent',
  'atlas_customer.CommerceShippingQuote', 'atlas_customer.CommerceShippingPayment',
  'atlas_customer.CommerceShippingProviderEvent', 'atlas_customer.CommerceShippingReceipt',
  'atlas_customer.WeeklyCapacityConfig', 'atlas_customer.WeeklyCapacityWeek',
  'atlas_customer.WeeklyCapacitySharedPolicy', 'atlas_customer.WeeklyCapacitySharedWeek',
  'atlas_customer.WeeklyCapacityReservation', 'atlas_dealer.commission_event', 'atlas_dealer.order_inbox_acknowledgment',
  ...controls,
];
assert.deepEqual([...order].sort(), exported);
const exceptions = [
  { table: 'atlas_customer.CommerceOrder', trigger: 'dealer_order_paid', reason: 'Historical paid order must not recreate purged physical dealer cards or commissions.' },
  { table: 'atlas_customer.CommercePayment', trigger: 'CommercePayment_weekly_capacity', reason: 'Restore the separately preserved capacity facts without deriving duplicate reservations.' },
  { table: 'atlas_customer.WeeklyCapacitySharedPolicy', trigger: 'WeeklyCapacitySharedPolicy_valid', reason: 'Historical effective dates cannot pass the future-policy insertion guard; ordinary checks remain active.' },
  { table: 'atlas_staff.SmsPilotControl', trigger: 'SmsPilotControl_no_replace', reason: 'Insert fresh disabled policies into the empty target; ordinary checks and update guards remain active.' },
];

export function retainedSourceSQL() {
  const counts = manifest.tables.map(t => `SELECT '${t}' name,count(*)::bigint n FROM ${quoted(t)}`).join(' UNION ALL ');
  const rows = exported.map(t => `'${t}',(SELECT COALESCE(jsonb_agg(rowtext ORDER BY rowtext COLLATE "C"),'[]'::jsonb) FROM (SELECT to_jsonb(t)::text rowtext FROM ${quoted(t)} t) s)`).join(',');
  return `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL statement_timeout='30s'; SET LOCAL TIME ZONE 'UTC'; SELECT jsonb_build_object('readOnly',current_setting('transaction_read_only'),'observedAt',clock_timestamp(),'counts',(SELECT jsonb_object_agg(name,n) FROM (${counts}) c),'rows',jsonb_build_object(${rows}))::text; ROLLBACK;`;
}

function observation(snapshot) {
  assert.equal(snapshot.writes, 0, 'SOURCE_WRITES_NOT_ZERO');
  const source = snapshot.observation;
  assert.equal(source?.readOnly, 'on', 'SOURCE_NOT_READ_ONLY');
  assert(Number.isFinite(Date.parse(source.observedAt)), 'SOURCE_TIME_INVALID');
  assert.deepEqual(Object.keys(source.counts).sort(), [...manifest.tables].sort(), 'SOURCE_TABLE_SET_DIFFERS');
  assert.deepEqual(Object.keys(source.rows).sort(), exported, 'SOURCE_ROW_ALLOWLIST_DIFFERS');
  for (const t of manifest.tables) assert(Number.isSafeInteger(source.counts[t]) && source.counts[t] >= 0, 'SOURCE_COUNT_INVALID');
  for (const t of zeroSource) assert.equal(source.counts[t], 0, `SOURCE_MUST_BE_EMPTY:${t}`);
  for (const t of exported) {
    assert(Array.isArray(source.rows[t]));
    assert.equal(source.rows[t].length, source.counts[t], `SOURCE_ROW_COUNT_DIFFERS:${t}`);
    for (const row of source.rows[t]) assert(typeof row === 'string' && JSON.parse(row) && !Array.isArray(JSON.parse(row)), 'SOURCE_ROW_INVALID');
  }
  // A changed dealer population needs a new closure review, not another implicit trigger exception.
  for (const t of exact.filter(t => t.startsWith('atlas_dealer.'))) assert.equal(source.counts[t], 0, `DEALER_SOURCE_REQUIRES_REVIEW:${t}`);
  for (const t of ['atlas_customer.CommercePayment', 'atlas_customer.CommerceShippingPayment'])
    for (const row of source.rows[t]) assert(['PAID', 'CANCELED'].includes(JSON.parse(row).state), `UNRECONCILED_PAYMENT:${t}`);
  for (const row of source.rows['atlas_customer.CommerceEffect']) assert(['SUCCEEDED', 'FAILED'].includes(JSON.parse(row).state), 'UNRECONCILED_COMMERCE_EFFECT');
  return source;
}

/** Explicit fresh bindings only. This does not activate any surface or SMS pilot. */
export function disabledRetainedControls(snapshot, { staff, publicReader, customer, customerService, commerce, at }) {
  const source = observation(snapshot), result = {};
  assert(Number.isFinite(Date.parse(at)), 'CONTROL_TIMESTAMP_REQUIRED');
  const flat = { 'atlas_staff.StaffControl': staff, 'atlas_staff.PublicReaderControl': publicReader, 'atlas_customer.CustomerControl': customer };
  const nested = { 'atlas_customer.CustomerServiceControl': customerService, 'atlas_customer.CommerceControl': commerce };
  for (const t of controls) result[t] = source.rows[t].map(text => {
    const row = JSON.parse(text); row.enabled = false;
    if ('updatedAt' in row) row.updatedAt = at;
    if ('revision' in row) row.revision += 1;
    if (flat[t]) {
      assert.deepEqual(Object.keys(flat[t]).sort(), ['configHash', 'deploymentId', 'mode', 'origin', 'releaseSha']);
      Object.assign(row, flat[t]);
    } else if (t in flat) throw new Error(`FRESH_CONTROL_BINDING_REQUIRED:${t}`);
    if (t in nested) { assert(nested[t] && typeof nested[t] === 'object', `FRESH_CONTROL_BINDING_REQUIRED:${t}`); row.binding = nested[t]; }
    if ('identificationEnabled' in row) row.identificationEnabled = false;
    if (t === 'atlas_staff.SmsPilotControl') {
      for (const k of ['pilotId', 'allowedPhoneHash', 'allowedDestinationHash', 'accountSid', 'serviceSid', 'feeEvidenceHash', 'binding', 'activatedAt', 'expiresAt']) row[k] = null;
      row.publicCustomerAdmission = false;
    }
    return row;
  });
  return result;
}

export function prepareRetainedCopy(snapshot, { controlRows, geometryConcurrency, neutralReleaseId, reason }) {
  const source = observation(snapshot);
  assert.equal(geometryConcurrency, 12, 'REVIEWED_R16_GEOMETRY_CAPACITY_MUST_BE_12');
  assert.match(neutralReleaseId, /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/);
  assert(typeof reason === 'string' && reason.trim().length >= 16 && reason.length <= 500, 'EXPLICIT_NEUTRAL_BASELINE_REASON_REQUIRED');
  assert.deepEqual(Object.keys(controlRows).sort(), [...controls].sort(), 'CONTROL_ALLOWLIST_DIFFERS');
  for (const t of controls) {
    assert.equal(controlRows[t].length, source.rows[t].length, `CONTROL_COUNT_DIFFERS:${t}`);
    for (const row of controlRows[t]) {
      assert.equal(row.enabled, false, 'CONTROL_MUST_REMAIN_DISABLED');
      if ('identificationEnabled' in row) assert.equal(row.identificationEnabled, false);
      if (t.endsWith('.SmsPilotControl')) assert(row.activatedAt === null && row.expiresAt === null && row.binding === null && row.publicCustomerAdmission === false, 'OLD_SMS_PILOT_REFUSED');
    }
  }
  const plan = {
    version: 'atlas-standalone-retained-copy-v1', baselineSha256: policy.schemaSha256,
    sourceSnapshotSha256: retainedCopyHash(snapshot), sourceObservedAt: source.observedAt,
    rows: Object.fromEntries(order.map(t => [t, controls.includes(t) ? controlRows[t].map(canonical) : source.rows[t]])),
    sourceTableDigests: Object.fromEntries(exported.map(t => [t, { count: source.rows[t].length, sha256: retainedCopyHash([...source.rows[t]].sort()) }])),
    triggerExceptions: exceptions.filter(e => source.rows[e.table].length > 0),
    geometryConcurrency, neutralReleaseId, neutralManifest, reason,
    excluded: { tables: manifest.tables.filter(t => !exported.includes(t)), historicalReferenceCache: 'Excluded by owner direction: historical query/label/image cache has mixed provenance. New independent reference caching remains available.' },
  };
  return { plan, sha256: retainedCopyHash(plan) };
}

async function tableRows(client, table) {
  return (await client.query(`SELECT to_jsonb(t)::text rowtext FROM ${quoted(table)} t ORDER BY to_jsonb(t)::text COLLATE "C"`)).rows.map(r => r.rowtext);
}

/** Caller owns explicit connection and external fresh-source/writer-freeze evidence.
 * Defaults to rollback; no credential discovery, network, automatic retry or activation. */
export async function executeRetainedCopy(client, { plan, reviewedPlanSha256, commit = false, expectedDatabase }) {
  assert.equal(retainedCopyHash(plan), reviewedPlanSha256, 'COPY_PLAN_REVIEW_HASH_DIFFERS');
  assert.equal(plan.baselineSha256, policy.schemaSha256);
  assert.equal(plan.version, 'atlas-standalone-retained-copy-v1');
  assert.deepEqual(Object.keys(plan.rows).sort(), exported);
  assert.equal(plan.geometryConcurrency, 12);
  assert.equal(plan.neutralManifest, neutralManifest);
  assert.deepEqual(plan.triggerExceptions, exceptions.filter(e => plan.rows[e.table].length > 0));
  assert(typeof expectedDatabase === 'string' && expectedDatabase.length > 0, 'EXPLICIT_TARGET_DATABASE_REQUIRED');
  await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  try {
    await client.query("SET LOCAL TIME ZONE 'UTC'; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s'");
    assert.equal((await client.query('SELECT current_database() name')).rows[0].name, expectedDatabase, 'TARGET_DATABASE_DIFFERS');
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('atlas-standalone-retained-copy-v1',0))");
    await client.query(`LOCK TABLE ${manifest.tables.map(quoted).join(',')} IN ACCESS EXCLUSIVE MODE`);
    const ledger = (await client.query('SELECT checksum FROM atlas_staff._standalone_migrations')).rows;
    assert.equal(ledger.length, 1); assert.equal(ledger[0].checksum, policy.schemaSha256, 'TARGET_BASELINE_DIFFERS');
    for (const t of manifest.tables) assert.equal((await tableRows(client, t)).length, 0, `TARGET_NOT_EMPTY:${t}`);
    const triggers = (await client.query("SELECT n.nspname||'.'||c.relname relation,t.tgname name,t.tgenabled enabled,pg_get_triggerdef(t.oid) definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname LIKE 'atlas_%' AND NOT t.tgisinternal ORDER BY 1,2")).rows;
    assert.equal(triggers.length, 161, 'TARGET_TRIGGER_COUNT_DIFFERS');
    assert(triggers.every(t => t.enabled === 'O'), 'TARGET_TRIGGER_ALREADY_DISABLED');
    const disabled = [];
    for (const exception of plan.triggerExceptions) {
      assert(triggers.some(t => t.relation === exception.table && t.name === exception.trigger), 'IMPORT_TRIGGER_MISSING');
      await client.query(`ALTER TABLE ${quoted(exception.table)} DISABLE TRIGGER ${quoted(exception.trigger)}`); disabled.push(exception);
    }
    const digests = {};
    for (const t of order) {
      const rows = plan.rows[t];
      if (rows.length) {
        const payload = '[' + rows.join(',') + ']';
        // Typed projection normalizes new control timestamps; exact retained rows must match source text.
        const expected = controls.includes(t) ? (await client.query(`SELECT to_jsonb(r)::text rowtext FROM jsonb_populate_recordset(NULL::${quoted(t)},$1::jsonb) r ORDER BY to_jsonb(r)::text COLLATE "C"`, [payload])).rows.map(r => r.rowtext) : [...rows].sort();
        await client.query(`INSERT INTO ${quoted(t)} SELECT * FROM jsonb_populate_recordset(NULL::${quoted(t)},$1::jsonb)`, [payload]);
        const actual = await tableRows(client, t); assert.deepEqual(actual, expected, `COPY_ROW_BYTES_DIFFER:${t}`);
        digests[t] = { count: actual.length, sha256: retainedCopyHash(actual) };
      } else digests[t] = { count: 0, sha256: retainedCopyHash([]) };
    }
    for (const exception of disabled) await client.query(`ALTER TABLE ${quoted(exception.table)} ENABLE TRIGGER ${quoted(exception.trigger)}`);
    const afterTriggers = (await client.query("SELECT n.nspname||'.'||c.relname relation,t.tgname name,t.tgenabled enabled,pg_get_triggerdef(t.oid) definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname LIKE 'atlas_%' AND NOT t.tgisinternal ORDER BY 1,2")).rows;
    assert.deepEqual(afterTriggers, triggers, 'TRIGGER_RESTORATION_DIFFERS');
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    for (const t of controls) assert((await tableRows(client, t)).every(text => JSON.parse(text).enabled === false), `CONTROL_ACTIVATED:${t}`);
    for (const t of manifest.tables.filter(t => !exported.includes(t))) assert.equal((await tableRows(client, t)).length, 0, `EXCLUDED_TABLE_POPULATED:${t}`);
    await client.query('INSERT INTO atlas_manual_connected.geometry_claim_capacity(singleton,concurrency) VALUES(true,$1)', [plan.geometryConcurrency]);
    await client.query('INSERT INTO atlas_manual.learning_release(id,manifest,manifest_hash) VALUES($1,$2,$3)', [plan.neutralReleaseId, plan.neutralManifest, retainedCopyHash(plan.neutralManifest)]);
    await client.query("SELECT set_config('atlas.learning_change_reason',$1,true)", [plan.reason]);
    await client.query('INSERT INTO atlas_manual.learning_control(singleton,active_release_id) VALUES(true,$1)', [plan.neutralReleaseId]);
    const history = (await client.query('SELECT previous_release_id,active_release_id,reason FROM atlas_manual.learning_activation_history')).rows;
    assert.deepEqual(history, [{ previous_release_id: null, active_release_id: plan.neutralReleaseId, reason: plan.reason }], 'NEUTRAL_BASELINE_HISTORY_DIFFERS');
    for (const t of zeroSource.filter(t => t !== 'atlas_manual.learning_activation_history')) assert.equal((await tableRows(client, t)).length, 0, `NEUTRAL_BASELINE_NOT_EMPTY:${t}`);
    const receipt = { status: commit ? 'COPIED_DISABLED_NEUTRAL_BASELINE' : 'ROLLBACK_REHEARSAL_PASSED', planSha256: reviewedPlanSha256, sourceSnapshotSha256: plan.sourceSnapshotSha256, digests, triggersRestored: triggers.length, geometryConcurrency: plan.geometryConcurrency, neutralReleaseId: plan.neutralReleaseId, newActivationHistoryRows: 1, copiedHistoricalLearningRows: 0, copiedSessionRows: 0, providerCalls: 0 };
    await client.query(commit ? 'COMMIT' : 'ROLLBACK');
    return receipt;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}
