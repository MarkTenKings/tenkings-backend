type WorksheetDraftRow = {
  setId: string;
  cardNumber: string | null;
  playerSeed: string;
  sourceUrl: string | null;
  raw: Record<string, unknown>;
};

/** Keep source observations alongside human edits. This does not validate or
 * approve them; source ingestion and catalog publication retain that authority. */
export function serializeWorksheetDraftRow(
  row: WorksheetDraftRow,
  fields: { team: string; subset: string; rookie: boolean },
): Record<string, unknown> {
  // The editor writes an explicit boolean to raw.isRookie when the user changes
  // the control. The display's unchecked state alone cannot establish false.
  const rawRookie = row.raw.isRookie ?? row.raw.rookie;
  const knownRookie = typeof rawRookie === "boolean"
    || rawRookie === 0 || rawRookie === 1
    || (typeof rawRookie === "string" && ["true", "1", "yes", "rookie", "rc", "false", "0", "no"].includes(rawRookie.trim().toLowerCase()));
  const rookie = knownRookie ? fields.rookie : null;
  return {
    ...row.raw,
    setId: row.setId,
    cardNumber: row.cardNumber,
    playerSeed: row.playerSeed,
    playerName: row.playerSeed,
    team: fields.team,
    teamName: fields.team,
    cardType: fields.subset || null,
    subset: fields.subset || null,
    isRookie: rookie,
    rookie: rookie === null ? null : rookie ? "Rookie" : "",
    sourceUrl: row.sourceUrl,
  };
}
