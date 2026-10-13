/** Fresh coordination only. Caller supplies the reviewed value and connection;
 * no old row, credential, release/control activation or learned data is copied. */
export async function initializeStandaloneCoordination(client, { geometryConcurrency }) {
  if (!Number.isInteger(geometryConcurrency) || geometryConcurrency < 1 || geometryConcurrency > 12)
    throw new Error('STANDALONE_GEOMETRY_CONCURRENCY_INVALID');
  await client.query('BEGIN');
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('atlas-standalone-coordination-v1',0))");
    const { rows } = await client.query('SELECT singleton,concurrency FROM atlas_manual_connected.geometry_claim_capacity');
    if (rows.length) {
      if (rows.length !== 1 || rows[0].singleton !== true || rows[0].concurrency !== geometryConcurrency)
        throw new Error('STANDALONE_COORDINATION_DIFFERS');
      await client.query('COMMIT');
      return { status: 'NO_OP', geometryConcurrency };
    }
    await client.query('INSERT INTO atlas_manual_connected.geometry_claim_capacity(singleton,concurrency) VALUES(true,$1)', [geometryConcurrency]);
    await client.query('COMMIT');
    return { status: 'INITIALIZED', geometryConcurrency };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}
