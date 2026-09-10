import { Prisma } from '@prisma/client';
import {
  CardInventoryErrorV2, CARD_INVENTORY_SOURCE_V2, CARD_INVENTORY_MAX_BYTES,
  InventorySourceEventInput, InventoryPageInput, parseCardInventoryCommandV2,
  cardInventorySourceEventIdV2, canonical, inventoryHash,
  type CardInventoryCommandV2, type InventorySourceEvent,
} from './cardInventoryV2';

export type CardInventoryReadClientV2 = Pick<Prisma.TransactionClient, '$queryRaw'>;
export type CardInventoryProjectionV2 = {
  currentOwnerType: 'HOUSE' | 'EXTERNAL'; currentOwnerId: null;
  lifecycleState: string; locationId: string | null; saleMode: 'PACK' | 'DIRECT';
};
export type CardInventoryContentV2 = {
  command: CardInventoryCommandV2; event: InventorySourceEvent;
  card_before: CardInventoryProjectionV2; card_after: CardInventoryProjectionV2;
};
export type CardInventoryRowV2 = {
  sequence: bigint; id: string; cardId: string; recordedAt: Date;
  content: string; contentHash: string; requestHash: string;
};

export function verifyCardInventoryRowV2(row: CardInventoryRowV2): CardInventoryContentV2 {
  const fail = () => { throw new CardInventoryErrorV2('INTEGRITY', 'Inventory journal integrity verification failed'); };
  try {
    const data = JSON.parse(row.content) as CardInventoryContentV2;
    if (canonical(data) !== row.content || inventoryHash(data) !== row.contentHash ||
      canonical(Object.keys(data).sort()) !== canonical(['card_after', 'card_before', 'command', 'event'])) return fail();
    const command = parseCardInventoryCommandV2(data.command);
    const event = InventorySourceEventInput.parse(data.event);
    if (canonical(command) !== canonical(data.command) || canonical(event) !== canonical(data.event) ||
      command.card_id !== row.cardId || event.source_event_id !== row.id ||
      row.id !== cardInventorySourceEventIdV2(command.request_id) ||
      BigInt(event.source_sequence) !== BigInt(row.sequence) ||
      event.recorded_at !== row.recordedAt.toISOString() || event.recorded_at > new Date().toISOString() ||
      inventoryHash({ command, actor: event.recorded_by }) !== row.requestHash) return fail();
    const expected = { ...command.event, source_event_id: row.id, source_sequence: event.source_sequence,
      recorded_at: event.recorded_at, recorded_by: event.recorded_by,
      stock_id: ['opening', 'receipt', 'pack'].includes(event.event_kind) ? row.id : command.event.stock_id };
    if (canonical(expected) !== canonical(event)) return fail();
    for (const projection of [data.card_before, data.card_after]) {
      if (!projection || canonical(Object.keys(projection).sort()) !== canonical(['currentOwnerId', 'currentOwnerType', 'lifecycleState', 'locationId', 'saleMode']) ||
        !['HOUSE', 'EXTERNAL'].includes(projection.currentOwnerType) || projection.currentOwnerId !== null ||
        !['GRADED', 'IN_INVENTORY', 'ASSIGNED_TO_PACK', 'AT_LOCATION', 'EXTERNAL'].includes(projection.lifecycleState) ||
        !['PACK', 'DIRECT'].includes(projection.saleMode) ||
        !(projection.locationId === null || (typeof projection.locationId === 'string' && /^[a-f0-9-]{36}$/i.test(projection.locationId)))) return fail();
    }
    return data;
  } catch { return fail(); }
}

export async function readCardInventoryCardHistoryV2(db: CardInventoryReadClientV2, cardId: string) {
  const [size] = await db.$queryRaw<{ count: bigint; bytes: bigint }[]>(Prisma.sql`
    SELECT COUNT(*)::bigint AS count, COALESCE(SUM(octet_length("content")), 0)::bigint AS bytes
    FROM "CardInventoryEventV2" WHERE "cardId" = ${cardId}
  `);
  if (size.count > 10000n || size.bytes > BigInt(CARD_INVENTORY_MAX_BYTES)) {
    throw new CardInventoryErrorV2('INTEGRITY', 'Card inventory history exceeds the bounded replay limit');
  }
  const rows = await db.$queryRaw<CardInventoryRowV2[]>(Prisma.sql`
    SELECT * FROM "CardInventoryEventV2" WHERE "cardId" = ${cardId} ORDER BY "sequence" ASC LIMIT 10001
  `);
  if (BigInt(rows.length) !== size.count) throw new CardInventoryErrorV2('INTEGRITY', 'Card inventory changed outside the expected transaction snapshot');
  return rows.map(verifyCardInventoryRowV2);
}

export async function exportCardInventoryPageV2(db: CardInventoryReadClientV2, input: {
  after_sequence: number; limit: number; snapshot_through_sequence?: number;
}) {
  const { after_sequence: after, limit, snapshot_through_sequence: bound } = input;
  if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000 ||
    (bound !== undefined && (!Number.isSafeInteger(bound) || bound < after))) {
    throw new CardInventoryErrorV2('INVALID_INPUT', 'Invalid inventory snapshot cursor');
  }
  const [watermark] = await db.$queryRaw<{ maximum: bigint }[]>(Prisma.sql`
    SELECT COALESCE(MAX("sequence"), 0)::bigint AS maximum FROM "CardInventoryEventV2"
  `);
  const maximum = Number(watermark?.maximum);
  const snapshot = bound ?? maximum;
  if (!Number.isSafeInteger(maximum) || maximum < 0) throw new CardInventoryErrorV2('INTEGRITY', 'Inventory sequence is invalid');
  if (snapshot > maximum || after > snapshot) throw new CardInventoryErrorV2('INVALID_INPUT', 'Inventory cursor is beyond the committed journal');
  const [coverage] = await db.$queryRaw<{ count: bigint }[]>(Prisma.sql`
    SELECT COUNT(*)::bigint AS count FROM "CardInventoryEventV2" WHERE "sequence" <= ${BigInt(snapshot)}
  `);
  if (BigInt(coverage.count) !== BigInt(snapshot)) throw new CardInventoryErrorV2('INTEGRITY', 'Inventory journal contains a sequence gap');
  const rows = await db.$queryRaw<CardInventoryRowV2[]>(Prisma.sql`
    SELECT * FROM "CardInventoryEventV2"
    WHERE "sequence" > ${BigInt(after)} AND "sequence" <= ${BigInt(snapshot)} ORDER BY "sequence" ASC LIMIT ${limit}
  `);
  if (rows.length !== Math.min(limit, snapshot - after)) throw new CardInventoryErrorV2('INTEGRITY', 'Inventory page is incomplete');
  const events = rows.map((row, i) => {
    if (BigInt(row.sequence) !== BigInt(after + i + 1)) throw new CardInventoryErrorV2('INTEGRITY', 'Inventory page is not contiguous');
    return verifyCardInventoryRowV2(row).event;
  });
  // Validate every selected row before imposing a response byte budget. A next
  // page resumes exactly at the last emitted sequence under the same snapshot.
  const selected: InventorySourceEvent[] = [];
  let bytes = 1024;
  for (const event of events) {
    const addition = Buffer.byteLength(JSON.stringify(event), 'utf8') + 1;
    if (bytes + addition > CARD_INVENTORY_MAX_BYTES) break;
    selected.push(event); bytes += addition;
  }
  if (!selected.length && after < snapshot) throw new CardInventoryErrorV2('INTEGRITY', 'Inventory event exceeds the export limit');
  const result = { page: InventoryPageInput.parse({ schema_version: 1, source_system: CARD_INVENTORY_SOURCE_V2,
    snapshot_id: 'v2-inventory:' + snapshot, after_sequence: after, through_sequence: after + selected.length,
    events: selected }), snapshot_through_sequence: snapshot };
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > CARD_INVENTORY_MAX_BYTES) throw new CardInventoryErrorV2('INTEGRITY', 'Inventory response exceeds the export limit');
  return result;
}
