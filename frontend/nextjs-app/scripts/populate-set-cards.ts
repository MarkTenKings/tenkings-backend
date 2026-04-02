type PrismaClientType = InstanceType<(typeof import("@prisma/client"))["PrismaClient"]>;

type CliOptions = {
  batchSize: number;
  dryRun: boolean;
  help: boolean;
  limit: number | null;
  setIds: string[];
  verbose: boolean;
};

type ProgramRow = {
  programId: string;
  label: string;
};

type ChecklistVersionContext = {
  approvalId: string;
  draftVersionId: string;
  ingestionJobId: string | null;
  rowCount: number;
  rows: DraftRow[];
};

type CandidateSetCardRow = {
  setId: string;
  programId: string;
  cardNumber: string;
  playerName: string | null;
  team: string | null;
  isRookie: boolean | null;
  sourceId: string | null;
  legacyProgramId: string | null;
  legacyStrategy: string | null;
};

type ExistingSetCardRow = {
  programId: string;
  cardNumber: string;
  playerName: string | null;
  team: string | null;
  isRookie: boolean | null;
  sourceId: string | null;
};

type DraftValidationIssue = {
  field: string;
  message: string;
  blocking: boolean;
};

type DraftRow = {
  setId: string;
  cardNumber: string | null;
  cardType: string | null;
  playerSeed: string;
  errors: DraftValidationIssue[];
  raw: Record<string, unknown>;
};

type SetProcessResult = {
  setId: string;
  status:
    | "processed"
    | "skipped_no_checklist_approval"
    | "skipped_no_checklist_source"
    | "skipped_no_programs"
    | "skipped_no_candidate_rows";
  createdPrograms: number;
  approvalId: string | null;
  draftVersionId: string | null;
  ingestionJobId: string | null;
  checklistSourceId: string | null;
  totalDraftRows: number;
  eligibleDraftRows: number;
  candidateRows: number;
  missingCardNumberRows: number;
  blockingRows: number;
  unmatchedProgramRows: number;
  duplicateCandidateRows: number;
  inserted: number;
  moved: number;
  updated: number;
  existingUnchanged: number;
  sampleUnmatchedPrograms: string[];
};

const DEFAULT_BATCH_SIZE = 250;
const UPDATE_BATCH_SIZE = 100;
const GENERIC_PROGRAM_TERMS = /\b(cards?|checklists?|set|sets)\b/g;
let prisma: PrismaClientType | null = null;

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    batchSize: DEFAULT_BATCH_SIZE,
    dryRun: false,
    help: false,
    limit: null,
    setIds: [],
    verbose: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") continue;
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--verbose") {
      options.verbose = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--batch-size") {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error("--batch-size requires a positive integer");
      }
      options.batchSize = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--batch-size=")) {
      const value = Number(arg.slice("--batch-size=".length));
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error("--batch-size requires a positive integer");
      }
      options.batchSize = value;
      continue;
    }
    if (arg === "--limit") {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error("--limit requires a positive integer");
      }
      options.limit = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--limit=")) {
      const value = Number(arg.slice("--limit=".length));
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error("--limit requires a positive integer");
      }
      options.limit = value;
      continue;
    }
    if (arg === "--set-id") {
      const value = normalizeSetLabel(argv[index + 1] ?? "");
      if (!value) {
        throw new Error("--set-id requires a non-empty value");
      }
      options.setIds.push(value);
      index += 1;
      continue;
    }
    if (arg.startsWith("--set-id=")) {
      const value = normalizeSetLabel(arg.slice("--set-id=".length));
      if (!value) {
        throw new Error("--set-id requires a non-empty value");
      }
      options.setIds.push(value);
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  options.setIds = Array.from(new Set(options.setIds));
  return options;
}

function printUsage() {
  console.log(`Populate SetCard rows from approved checklist draft versions.

Usage:
  pnpm --filter @tenkings/nextjs-app exec tsx scripts/populate-set-cards.ts [options]

Options:
  --dry-run            Show what would be inserted/updated without writing
  --batch-size <n>     Insert batch size (default: 250)
  --limit <n>          Process only the first N approved sets
  --set-id <setId>     Restrict to one set; repeatable
  --verbose            Print unmatched program details
  --help, -h           Show this help output

Requirements:
  DATABASE_URL must point at the target database.
`);
}

async function getPrisma() {
  if (prisma) return prisma;
  const { PrismaClient } = await import("@prisma/client");
  prisma = new PrismaClient();
  return prisma;
}

function collapseWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeSetLabel(value: string | null | undefined): string {
  return collapseWhitespace(String(value ?? ""));
}

function sanitizeTaxonomyText(value: unknown): string {
  return normalizeSetLabel(String(value ?? ""));
}

function normalizeTaxonomyKey(value: unknown): string {
  return sanitizeTaxonomyText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function normalizeProgramId(value: unknown): string {
  return normalizeTaxonomyKey(value) || "base";
}

function normalizeTaxonomyCardNumber(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const compact = raw.replace(/^#\s*/, "").replace(/\s+/g, "");
  const upper = compact.toUpperCase();
  if (!upper) return null;
  if (upper === "ALL") return "ALL";
  if (["NULL", "N/A", "NA", "NONE", "-", "--"].includes(upper)) {
    return null;
  }
  return upper;
}

function normalizeProgramLabelKey(value: string | null | undefined): string {
  return collapseWhitespace(sanitizeTaxonomyText(value).toLowerCase());
}

function stripGenericProgramTerms(value: string | null | undefined): string {
  return collapseWhitespace(normalizeProgramLabelKey(value).replace(GENERIC_PROGRAM_TERMS, " "));
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

function appendLookupProgram(map: Map<string, ProgramRow[]>, key: string, program: ProgramRow) {
  if (!key) return;
  const existing = map.get(key) ?? [];
  if (existing.some((candidate) => candidate.programId === program.programId && candidate.label === program.label)) {
    return;
  }
  map.set(key, [...existing, program]);
}

function buildProgramLookup(programs: ProgramRow[]) {
  const byExactLabel = new Map<string, ProgramRow[]>();
  const byProgramId = new Map<string, ProgramRow[]>();
  const byStrippedLabel = new Map<string, ProgramRow[]>();

  for (const program of programs) {
    const exactKey = normalizeProgramLabelKey(program.label);
    const strippedKey = stripGenericProgramTerms(program.label);
    const idKey = normalizeProgramId(program.label);

    if (exactKey) {
      appendLookupProgram(byExactLabel, exactKey, program);
    }
    if (idKey) {
      appendLookupProgram(byProgramId, idKey, program);
    }
    if (strippedKey) {
      appendLookupProgram(byStrippedLabel, strippedKey, program);
    }

    const storedProgramIdKey = normalizeProgramId(program.programId);
    if (storedProgramIdKey) {
      appendLookupProgram(byProgramId, storedProgramIdKey, program);
    }
  }

  return {
    programs,
    byExactLabel,
    byProgramId,
    byStrippedLabel,
  };
}

function inferProgramClass(label: string | null): string | null {
  const text = sanitizeTaxonomyText(label).toLowerCase();
  if (!text) return null;
  if (/auto|autograph|signature/.test(text)) return "autograph";
  if (/relic|memorabilia|patch|jersey/.test(text)) return "relic";
  if (/base/.test(text)) return "base";
  return "insert";
}

function pickUniqueProgram(candidates: ProgramRow[] | undefined) {
  return candidates && candidates.length === 1 ? candidates[0] : null;
}

function resolveProgramIdForChecklistRow(
  rawProgramLabel: string | null,
  lookup: ReturnType<typeof buildProgramLookup>
): { programId: string | null; strategy: string | null } {
  const cleaned = sanitizeTaxonomyText(rawProgramLabel);
  const exactKey = normalizeProgramLabelKey(cleaned);
  const strippedKey = stripGenericProgramTerms(cleaned);
  const programIdKey = normalizeProgramId(cleaned);

  const exactMatch = pickUniqueProgram(lookup.byExactLabel.get(exactKey));
  if (exactMatch) {
    return { programId: exactMatch.programId, strategy: "exact_label" };
  }

  const idMatch = pickUniqueProgram(lookup.byProgramId.get(programIdKey));
  if (idMatch) {
    return { programId: idMatch.programId, strategy: "program_id" };
  }

  const strippedMatch = pickUniqueProgram(lookup.byStrippedLabel.get(strippedKey));
  if (strippedMatch) {
    return { programId: strippedMatch.programId, strategy: "stripped_label" };
  }

  if (!cleaned && lookup.programs.length === 1) {
    return { programId: lookup.programs[0].programId, strategy: "single_program_blank_card_type" };
  }

  const prefixMatches = lookup.programs.filter((program) => {
    const candidateExact = normalizeProgramLabelKey(program.label);
    const candidateStripped = stripGenericProgramTerms(program.label);
    return (
      (exactKey && candidateExact.startsWith(`${exactKey} `)) ||
      (strippedKey && candidateStripped === strippedKey) ||
      (strippedKey && candidateStripped.startsWith(`${strippedKey} `))
    );
  });
  if (prefixMatches.length === 1) {
    return { programId: prefixMatches[0].programId, strategy: "prefix_match" };
  }

  return { programId: null, strategy: null };
}

function datasetTypeFromJson(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const datasetType = String((value as Record<string, unknown>).datasetType || "").trim().toUpperCase();
  return datasetType || null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function extractDraftRows(dataJson: unknown): DraftRow[] {
  const record = asRecord(dataJson);
  if (!record || !Array.isArray(record.rows)) {
    return [];
  }

  return record.rows
    .map((value) => asRecord(value))
    .filter((row): row is Record<string, unknown> => Boolean(row))
    .map((row) => {
      const raw = asRecord(row.raw) ?? {};
      const errors = Array.isArray(row.errors)
        ? row.errors
            .map((value) => asRecord(value))
            .filter((value): value is Record<string, unknown> => Boolean(value))
            .map(
              (value) =>
                ({
                  field: String(value.field ?? ""),
                  message: String(value.message ?? ""),
                  blocking: Boolean(value.blocking),
                }) satisfies DraftValidationIssue
            )
        : [];

      return {
        setId: normalizeSetLabel(String(row.setId ?? "")),
        cardNumber: normalizeTaxonomyCardNumber(row.cardNumber),
        cardType: sanitizeTaxonomyText(row.cardType ?? "") || null,
        playerSeed: sanitizeTaxonomyText(row.playerSeed ?? "") || "",
        errors,
        raw,
      } satisfies DraftRow;
    });
}

function firstText(record: Record<string, unknown> | null | undefined, keys: string[]) {
  if (!record) return "";
  for (const key of keys) {
    const value = record[key];
    if (value == null) continue;
    const text = sanitizeTaxonomyText(value);
    if (text) return text;
  }
  return "";
}

function parseBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  const text = sanitizeTaxonomyText(value).toLowerCase();
  if (!text) return null;
  if (["1", "true", "yes", "y", "rookie", "rc"].includes(text)) return true;
  if (["0", "false", "no", "n"].includes(text)) return false;
  return null;
}

function buildSetCardKey(programId: string, cardNumber: string) {
  return `${programId}::${cardNumber}`;
}

function extractChecklistProgramLabel(row: DraftRow): string {
  return sanitizeTaxonomyText(
    row.cardType ??
      firstText(asRecord(row.raw), ["cardType", "program", "programLabel", "subset"]) ??
      ""
  );
}

function collectMissingChecklistPrograms(params: {
  setId: string;
  rows: DraftRow[];
  lookup: ReturnType<typeof buildProgramLookup>;
}): ProgramRow[] {
  const missingByProgramId = new Map<string, { label: string; count: number }>();

  for (const row of params.rows) {
    if (normalizeSetLabel(row.setId) !== params.setId) {
      continue;
    }

    if (row.errors.some((issue) => issue.blocking)) {
      continue;
    }

    const rawProgramLabel = extractChecklistProgramLabel(row);
    if (!rawProgramLabel) {
      continue;
    }

    const programId = normalizeProgramId(rawProgramLabel);
    const existingResolution = resolveProgramIdForChecklistRow(rawProgramLabel, params.lookup);
    const hasExactLabel = (params.lookup.byExactLabel.get(normalizeProgramLabelKey(rawProgramLabel)) ?? []).length > 0;
    const hasProgramId = (params.lookup.byProgramId.get(programId) ?? []).length > 0;
    const canReuseExistingProgram =
      existingResolution.strategy != null &&
      existingResolution.strategy !== "prefix_match";

    if (canReuseExistingProgram || hasExactLabel || hasProgramId) {
      continue;
    }

    const existing = missingByProgramId.get(programId);
    if (!existing) {
      missingByProgramId.set(programId, {
        label: rawProgramLabel,
        count: 1,
      });
      continue;
    }

    const nextCount = existing.count + 1;
    const preferNextLabel =
      rawProgramLabel.length > existing.label.length ||
      (rawProgramLabel.length === existing.label.length && rawProgramLabel.localeCompare(existing.label) < 0);
    missingByProgramId.set(programId, {
      label: preferNextLabel ? rawProgramLabel : existing.label,
      count: nextCount,
    });
  }

  return Array.from(missingByProgramId.entries())
    .sort(([leftId, left], [rightId, right]) => {
      if (right.count !== left.count) return right.count - left.count;
      if (left.label !== right.label) return left.label.localeCompare(right.label);
      return leftId.localeCompare(rightId);
    })
    .map(([programId, value]) => ({
      programId,
      label: value.label,
    }));
}

function sliceIntoBatches<T>(values: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < values.length; index += batchSize) {
    batches.push(values.slice(index, index + batchSize));
  }
  return batches;
}

async function loadApprovedChecklistVersion(draftId: string): Promise<ChecklistVersionContext | null> {
  const db = await getPrisma();
  const approvals = await db.setApproval.findMany({
    where: {
      draftId,
      decision: "APPROVED",
    },
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true,
      draftVersionId: true,
      draftVersion: {
        select: {
          id: true,
          rowCount: true,
          dataJson: true,
          sourceLinksJson: true,
        },
      },
    },
  });

  for (const approval of approvals) {
    const dataJson = approval.draftVersion?.dataJson ?? null;
    if (datasetTypeFromJson(dataJson) !== "PLAYER_WORKSHEET") {
      continue;
    }
    const sourceLinks = asRecord(approval.draftVersion?.sourceLinksJson);
    const ingestionJobId = typeof sourceLinks?.ingestionJobId === "string" ? sourceLinks.ingestionJobId : null;
    return {
      approvalId: approval.id,
      draftVersionId: approval.draftVersionId,
      ingestionJobId,
      rowCount: approval.draftVersion?.rowCount ?? 0,
      rows: extractDraftRows(dataJson),
    };
  }

  return null;
}

async function resolveChecklistSourceId(params: {
  setId: string;
  ingestionJobId: string | null;
}): Promise<string | null> {
  const db = await getPrisma();
  if (params.ingestionJobId) {
    const direct = await db.setTaxonomySource.findFirst({
      where: {
        setId: params.setId,
        ingestionJobId: params.ingestionJobId,
        artifactType: "CHECKLIST",
      },
      orderBy: [{ createdAt: "desc" }],
      select: { id: true },
    });
    if (direct?.id) {
      return direct.id;
    }
  }

  const fallback = await db.setTaxonomySource.findFirst({
    where: {
      setId: params.setId,
      artifactType: "CHECKLIST",
    },
    orderBy: [{ createdAt: "desc" }],
    select: { id: true },
  });
  return fallback?.id ?? null;
}

function needsSetCardUpdate(existing: ExistingSetCardRow, next: CandidateSetCardRow) {
  return Boolean(
    (!existing.playerName && next.playerName) ||
      (!existing.team && next.team) ||
      (existing.isRookie == null && next.isRookie != null) ||
      (!existing.sourceId && next.sourceId)
  );
}

async function processSet(params: {
  setIndex: number;
  totalSets: number;
  setId: string;
  draftId: string;
  batchSize: number;
  dryRun: boolean;
  verbose: boolean;
}): Promise<SetProcessResult> {
  const db = await getPrisma();
  const { setId } = params;
  console.log(`\n[${params.setIndex}/${params.totalSets}] ${setId}`);

  const checklistVersion = await loadApprovedChecklistVersion(params.draftId);
  if (!checklistVersion) {
    console.log("  skip: no approved PLAYER_WORKSHEET draft version");
    return {
      setId,
      status: "skipped_no_checklist_approval",
      createdPrograms: 0,
      approvalId: null,
      draftVersionId: null,
      ingestionJobId: null,
      checklistSourceId: null,
      totalDraftRows: 0,
      eligibleDraftRows: 0,
      candidateRows: 0,
      missingCardNumberRows: 0,
      blockingRows: 0,
      unmatchedProgramRows: 0,
      duplicateCandidateRows: 0,
      inserted: 0,
      moved: 0,
      updated: 0,
      existingUnchanged: 0,
      sampleUnmatchedPrograms: [],
    };
  }

  const sourceId = await resolveChecklistSourceId({
    setId,
    ingestionJobId: checklistVersion.ingestionJobId,
  });
  if (!sourceId) {
    console.log("  skip: no CHECKLIST SetTaxonomySource found");
    return {
      setId,
      status: "skipped_no_checklist_source",
      createdPrograms: 0,
      approvalId: checklistVersion.approvalId,
      draftVersionId: checklistVersion.draftVersionId,
      ingestionJobId: checklistVersion.ingestionJobId,
      checklistSourceId: null,
      totalDraftRows: checklistVersion.rows.length,
      eligibleDraftRows: 0,
      candidateRows: 0,
      missingCardNumberRows: 0,
      blockingRows: 0,
      unmatchedProgramRows: 0,
      duplicateCandidateRows: 0,
      inserted: 0,
      moved: 0,
      updated: 0,
      existingUnchanged: 0,
      sampleUnmatchedPrograms: [],
    };
  }

  let programs = await db.setProgram.findMany({
    where: { setId },
    orderBy: [{ label: "asc" }],
    select: {
      programId: true,
      label: true,
    },
  });
  const legacyLookup = buildProgramLookup(programs);
  let lookup = legacyLookup;
  const missingPrograms = collectMissingChecklistPrograms({
    setId,
    rows: checklistVersion.rows,
    lookup: legacyLookup,
  });
  let createdPrograms = 0;

  if (missingPrograms.length > 0) {
    if (!params.dryRun) {
      const created = await db.setProgram.createMany({
        data: missingPrograms.map((program) => ({
          setId,
          programId: program.programId,
          label: program.label,
          codePrefix: null,
          programClass: inferProgramClass(program.label),
          sourceId,
        })),
        skipDuplicates: true,
      });
      createdPrograms = created.count;
      programs = await db.setProgram.findMany({
        where: { setId },
        orderBy: [{ label: "asc" }],
        select: {
          programId: true,
          label: true,
        },
      });
    } else {
      createdPrograms = missingPrograms.length;
      programs = [...programs, ...missingPrograms];
    }
    lookup = buildProgramLookup(programs);
  }

  if (programs.length < 1) {
    console.log("  skip: no SetProgram rows exist for set");
    return {
      setId,
      status: "skipped_no_programs",
      createdPrograms,
      approvalId: checklistVersion.approvalId,
      draftVersionId: checklistVersion.draftVersionId,
      ingestionJobId: checklistVersion.ingestionJobId,
      checklistSourceId: sourceId,
      totalDraftRows: checklistVersion.rows.length,
      eligibleDraftRows: 0,
      candidateRows: 0,
      missingCardNumberRows: 0,
      blockingRows: 0,
      unmatchedProgramRows: 0,
      duplicateCandidateRows: 0,
      inserted: 0,
      moved: 0,
      updated: 0,
      existingUnchanged: 0,
      sampleUnmatchedPrograms: [],
    };
  }

  const candidateMap = new Map<string, CandidateSetCardRow>();
  const unmatchedPrograms = new Set<string>();
  let blockingRows = 0;
  let missingCardNumberRows = 0;
  let unmatchedProgramRows = 0;
  let duplicateCandidateRows = 0;
  let eligibleDraftRows = 0;

  for (const row of checklistVersion.rows) {
    if (normalizeSetLabel(row.setId) !== setId) {
      continue;
    }

    if (row.errors.some((issue) => issue.blocking)) {
      blockingRows += 1;
      continue;
    }

    const cardNumber = normalizeTaxonomyCardNumber(row.cardNumber ?? row.raw?.cardNumber ?? null);
    if (!cardNumber) {
      missingCardNumberRows += 1;
      continue;
    }

    const rawProgramLabel = extractChecklistProgramLabel(row);
    const legacyProgramResolution = resolveProgramIdForChecklistRow(rawProgramLabel, legacyLookup);
    const programResolution = resolveProgramIdForChecklistRow(rawProgramLabel, lookup);
    if (!programResolution.programId) {
      unmatchedProgramRows += 1;
      if (rawProgramLabel) {
        unmatchedPrograms.add(rawProgramLabel);
      } else {
        unmatchedPrograms.add("(blank)");
      }
      continue;
    }

    eligibleDraftRows += 1;
    const rawRecord = asRecord(row.raw);
    const playerName = sanitizeTaxonomyText(firstText(rawRecord, ["playerName", "player", "name"])) || null;
    const team = sanitizeTaxonomyText(firstText(rawRecord, ["team", "teamName", "team_name"])) || null;
    const isRookie = parseBoolean(rawRecord?.isRookie ?? rawRecord?.rookie ?? null);

    const candidate: CandidateSetCardRow = {
      setId,
      programId: programResolution.programId,
      cardNumber,
      playerName,
      team,
      isRookie,
      sourceId,
      legacyProgramId: legacyProgramResolution.programId,
      legacyStrategy: legacyProgramResolution.strategy,
    };

    const key = buildSetCardKey(candidate.programId, candidate.cardNumber);
    const existingCandidate = candidateMap.get(key);
    if (existingCandidate) {
      duplicateCandidateRows += 1;
      candidateMap.set(key, {
        ...existingCandidate,
        playerName: existingCandidate.playerName || candidate.playerName,
        team: existingCandidate.team || candidate.team,
        isRookie: existingCandidate.isRookie ?? candidate.isRookie,
        sourceId: existingCandidate.sourceId || candidate.sourceId,
      });
      continue;
    }
    candidateMap.set(key, candidate);
  }

  const candidates = Array.from(candidateMap.values()).sort((a, b) => {
    if (a.programId !== b.programId) return a.programId.localeCompare(b.programId);
    return a.cardNumber.localeCompare(b.cardNumber, undefined, { numeric: true, sensitivity: "base" });
  });

  if (candidates.length < 1) {
    console.log("  skip: no candidate checklist rows after filtering");
    return {
      setId,
      status: "skipped_no_candidate_rows",
      createdPrograms,
      approvalId: checklistVersion.approvalId,
      draftVersionId: checklistVersion.draftVersionId,
      ingestionJobId: checklistVersion.ingestionJobId,
      checklistSourceId: sourceId,
      totalDraftRows: checklistVersion.rows.length,
      eligibleDraftRows,
      candidateRows: 0,
      missingCardNumberRows,
      blockingRows,
      unmatchedProgramRows,
      duplicateCandidateRows,
      inserted: 0,
      moved: 0,
      updated: 0,
      existingUnchanged: 0,
      sampleUnmatchedPrograms: Array.from(unmatchedPrograms).slice(0, 8),
    };
  }

  const existingRows = await db.setCard.findMany({
    where: { setId },
    select: {
      programId: true,
      cardNumber: true,
      playerName: true,
      team: true,
      isRookie: true,
      sourceId: true,
    },
  });
  const existingByKey = new Map<string, ExistingSetCardRow>(
    existingRows.map((row) => [buildSetCardKey(row.programId, row.cardNumber), row])
  );

  const inserts: CandidateSetCardRow[] = [];
  const moves: Array<{
    fromProgramId: string;
    candidate: CandidateSetCardRow;
  }> = [];
  const updates: CandidateSetCardRow[] = [];
  let existingUnchanged = 0;

  for (const candidate of candidates) {
    const key = buildSetCardKey(candidate.programId, candidate.cardNumber);
    const existing = existingByKey.get(key);
    if (existing) {
      if (needsSetCardUpdate(existing, candidate)) {
        updates.push(candidate);
      } else {
        existingUnchanged += 1;
      }
      continue;
    }

    if (
      candidate.legacyStrategy === "prefix_match" &&
      candidate.legacyProgramId &&
      candidate.legacyProgramId !== candidate.programId
    ) {
      const legacyKey = buildSetCardKey(candidate.legacyProgramId, candidate.cardNumber);
      const legacyExisting = existingByKey.get(legacyKey);
      if (legacyExisting) {
        moves.push({
          fromProgramId: candidate.legacyProgramId,
          candidate,
        });
        existingByKey.delete(legacyKey);
        existingByKey.set(key, {
          programId: candidate.programId,
          cardNumber: candidate.cardNumber,
          playerName: legacyExisting.playerName ?? candidate.playerName,
          team: legacyExisting.team ?? candidate.team,
          isRookie: legacyExisting.isRookie ?? candidate.isRookie,
          sourceId: legacyExisting.sourceId ?? candidate.sourceId,
        });
        continue;
      }
    }

    inserts.push(candidate);
  }

  console.log(
    `  checklist rows=${checklistVersion.rows.length} eligible=${eligibleDraftRows} candidates=${candidates.length} missingCardNumber=${missingCardNumberRows} unmatchedProgram=${unmatchedProgramRows} duplicateCandidates=${duplicateCandidateRows}`
  );
  if (createdPrograms > 0) {
    console.log(`  ${params.dryRun ? "would create" : "created"} SetProgram rows=${createdPrograms}`);
  }
  console.log(
    `  ${params.dryRun ? "would write" : "writes"}: insert=${inserts.length} move=${moves.length} update=${updates.length} unchanged=${existingUnchanged} sourceId=${sourceId}`
  );
  if (params.verbose && unmatchedPrograms.size > 0) {
    console.log(`  unmatched card types: ${Array.from(unmatchedPrograms).slice(0, 20).join(" | ")}`);
  }

  if (!params.dryRun) {
    for (const batch of sliceIntoBatches(moves, UPDATE_BATCH_SIZE)) {
      await db.$transaction(
        batch.map((entry) =>
          db.setCard.update({
            where: {
              setId_programId_cardNumber: {
                setId: entry.candidate.setId,
                programId: entry.fromProgramId,
                cardNumber: entry.candidate.cardNumber,
              },
            },
            data: {
              programId: entry.candidate.programId,
              playerName: entry.candidate.playerName ?? undefined,
              team: entry.candidate.team ?? undefined,
              isRookie: entry.candidate.isRookie ?? undefined,
              sourceId: entry.candidate.sourceId ?? undefined,
            },
          })
        )
      );
    }

    for (const batch of sliceIntoBatches(inserts, params.batchSize)) {
      await db.setCard.createMany({
        data: batch.map((row) => ({
          setId: row.setId,
          programId: row.programId,
          cardNumber: row.cardNumber,
          playerName: row.playerName,
          team: row.team,
          isRookie: row.isRookie,
          sourceId: row.sourceId,
        })),
        skipDuplicates: true,
      });
    }

    for (const batch of sliceIntoBatches(updates, UPDATE_BATCH_SIZE)) {
      await db.$transaction(
        batch.map((row) =>
          db.setCard.update({
            where: {
              setId_programId_cardNumber: {
                setId: row.setId,
                programId: row.programId,
                cardNumber: row.cardNumber,
              },
            },
            data: {
              playerName: row.playerName ?? undefined,
              team: row.team ?? undefined,
              isRookie: row.isRookie ?? undefined,
              sourceId: row.sourceId ?? undefined,
            },
          })
        )
      );
    }
  }

  return {
    setId,
    status: "processed",
    createdPrograms,
    approvalId: checklistVersion.approvalId,
    draftVersionId: checklistVersion.draftVersionId,
    ingestionJobId: checklistVersion.ingestionJobId,
    checklistSourceId: sourceId,
    totalDraftRows: checklistVersion.rows.length,
    eligibleDraftRows,
    candidateRows: candidates.length,
    missingCardNumberRows,
    blockingRows,
    unmatchedProgramRows,
    duplicateCandidateRows,
    inserted: inserts.length,
    moved: moves.length,
    updated: updates.length,
    existingUnchanged,
    sampleUnmatchedPrograms: Array.from(unmatchedPrograms).slice(0, 8),
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }

  const db = await getPrisma();
  const approvedDrafts = await db.setDraft.findMany({
    where: {
      status: "APPROVED",
      archivedAt: null,
      ...(options.setIds.length > 0 ? { setId: { in: options.setIds } } : {}),
    },
    orderBy: [{ setId: "asc" }],
    select: {
      id: true,
      setId: true,
    },
    ...(options.limit ? { take: options.limit } : {}),
  });

  if (approvedDrafts.length < 1) {
    console.log("No approved active drafts found.");
    return;
  }

  console.log(
    `Processing ${approvedDrafts.length} approved set${approvedDrafts.length === 1 ? "" : "s"}${options.dryRun ? " (dry-run)" : ""}.`
  );

  const results: SetProcessResult[] = [];
  for (const [index, draft] of approvedDrafts.entries()) {
    const result = await processSet({
      setIndex: index + 1,
      totalSets: approvedDrafts.length,
      setId: draft.setId,
      draftId: draft.id,
      batchSize: options.batchSize,
      dryRun: options.dryRun,
      verbose: options.verbose,
    });
    results.push(result);
  }

  const summary = results.reduce(
    (accumulator, result) => {
      accumulator.processed += result.status === "processed" ? 1 : 0;
      accumulator.skipped += result.status === "processed" ? 0 : 1;
      accumulator.createdPrograms += result.createdPrograms;
      accumulator.inserted += result.inserted;
      accumulator.moved += result.moved;
      accumulator.updated += result.updated;
      accumulator.unchanged += result.existingUnchanged;
      accumulator.unmatchedProgramRows += result.unmatchedProgramRows;
      accumulator.missingCardNumberRows += result.missingCardNumberRows;
      accumulator.blockingRows += result.blockingRows;
      return accumulator;
    },
    {
      processed: 0,
      skipped: 0,
      createdPrograms: 0,
      inserted: 0,
      moved: 0,
      updated: 0,
      unchanged: 0,
      unmatchedProgramRows: 0,
      missingCardNumberRows: 0,
      blockingRows: 0,
    }
  );

  console.log("\nSummary");
  console.log(`  processed sets: ${summary.processed}`);
  console.log(`  skipped sets: ${summary.skipped}`);
  console.log(`  ${options.dryRun ? "would create" : "created"} SetProgram rows: ${summary.createdPrograms}`);
  console.log(`  ${options.dryRun ? "would insert" : "inserted"} rows: ${summary.inserted}`);
  console.log(`  ${options.dryRun ? "would move" : "moved"} rows: ${summary.moved}`);
  console.log(`  ${options.dryRun ? "would update" : "updated"} rows: ${summary.updated}`);
  console.log(`  unchanged existing rows: ${summary.unchanged}`);
  console.log(`  unmatched program rows: ${summary.unmatchedProgramRows}`);
  console.log(`  missing card-number rows: ${summary.missingCardNumberRows}`);
  console.log(`  blocking draft rows skipped: ${summary.blockingRows}`);

  const skipped = results.filter((result) => result.status !== "processed");
  if (skipped.length > 0) {
    console.log("\nSkipped Sets");
    for (const result of skipped) {
      console.log(`  ${result.setId}: ${result.status}`);
    }
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    if (prisma) {
      await prisma.$disconnect();
    }
  });
