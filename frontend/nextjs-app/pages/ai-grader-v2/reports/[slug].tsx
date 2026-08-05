/* eslint-disable @next/next/no-img-element */
import Head from "next/head";
import Link from "next/link";
import { useCallback, useState } from "react";
import type { GetServerSideProps, GetServerSidePropsContext } from "next";

import { DefectEvidenceViewer } from "../../../components/ai-grader-v2/DefectEvidenceViewer";
import { GradeSummary } from "../../../components/ai-grader-v2/GradeSummary";
import type {
  SpeedsterCardSide,
  SpeedsterDefectType,
  SpeedsterMeasuredDefect,
  SpeedsterPoint,
  SpeedsterReviewFinding,
} from "../../../lib/ai-grader-v2/contracts";
import type { calculateSpeedsterGrade } from "../../../lib/ai-grader-v2/scoring";
import {
  SPEEDSTER_CANONICAL_FRAME,
  parseSpeedsterInspectionFrame,
  type SpeedsterInspectionFrame,
} from "../../../lib/ai-grader-v2/inspection-frame";
import {
  encodeSpeedsterTraceRleV1,
  parseSpeedsterTraceRleV1,
} from "../../../lib/ai-grader-v2/trace-codec";
import { decodeSpeedsterTraceBitmapWireV1 } from "../../../lib/ai-grader-v2/trace-bitmap-wire";
import styles from "../../../styles/AiGraderV2Report.module.css";

type Grade = ReturnType<typeof calculateSpeedsterGrade>;
type PublicIdentity = {
  cardProfile: "POKEMON" | "SPORTS";
  playerName?: string;
  cardName?: string;
  year?: string;
  manufacturer?: string;
  productSet?: string;
  parallel?: string;
  insert?: string;
  cardNumber?: string;
};
type SourceKeys = Readonly<Record<SpeedsterCardSide, {
  master: string;
  inspectionFrame: SpeedsterInspectionFrame;
  views: Readonly<Record<"ORIGINAL" | "NORMALIZED" | "MICRO_DEFECT" | "DIRECTIONAL", string>>;
}>>;
type PublicReportSource = {
  publicReportSlug: string;
  identity: PublicIdentity;
  defects: SpeedsterReviewFinding[];
  grade: Grade;
  sourceKeys: SourceKeys;
  slabKeys: { front: string | null; back: string | null };
};
type PublicReportProps = Omit<PublicReportSource, "sourceKeys" | "slabKeys"> & {
  imageUrls: Readonly<Record<SpeedsterCardSide, {
    master: string;
    views: Readonly<Record<string, string>>;
  }>>;
  inspectionFrames: Readonly<Record<SpeedsterCardSide, SpeedsterInspectionFrame>>;
  slabImageUrls: { front: string | null; back: string | null };
};
type ReportDependencies = {
  findCompletedSession: (slug: string) => Promise<unknown | null>;
  presign: (storageKey: string) => Promise<string>;
};

const DEFECT_TYPES = new Set<SpeedsterDefectType>([
  "FAINT_COLOR_VARIATION",
  "VISIBLE_WHITENING",
  "FRAYING",
  "CHIPPING_EXPOSED_STOCK",
  "LIFTING_DEFORMATION",
  "LIGHT_SCRATCH_SCUFF",
  "VISIBLE_SCRATCH_PRINT_COATING_LOSS",
  "DENT_MATERIAL_DAMAGE",
  "PEELING_HEAVY_DAMAGE",
]);
const PUBLIC_REVIEW_RESULTS = new Set(["ACCEPTED", "SMART_MARKED", "TYPE_CORRECTED"]);
const VIEW_TYPES = ["ORIGINAL", "NORMALIZED", "MICRO_DEFECT", "DIRECTIONAL"] as const;
const IDENTITY_FIELDS = [
  "playerName", "cardName", "year", "manufacturer", "productSet", "parallel", "insert", "cardNumber",
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;

function point(value: unknown): SpeedsterPoint | null {
  if (!isRecord(value)) return null;
  const x = number(value.x);
  const y = number(value.y);
  return x !== null && y !== null && x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
}

function measuredDefect(value: unknown): SpeedsterReviewFinding | null {
  if (!isRecord(value)) return null;
  const side = value.side === "FRONT" || value.side === "BACK" ? value.side : null;
  const defectType = typeof value.defectType === "string" && DEFECT_TYPES.has(value.defectType as SpeedsterDefectType)
    ? value.defectType as SpeedsterDefectType
    : null;
  const origin = value.origin === "DETECTOR" || value.origin === "SMART_MARK" || value.origin === "MEMORY"
    ? value.origin
    : null;
  const detectedDefectType = typeof value.detectedDefectType === "string" &&
    DEFECT_TYPES.has(value.detectedDefectType as SpeedsterDefectType)
    ? value.detectedDefectType as SpeedsterDefectType
    : null;
  const reviewResult = typeof value.reviewResult === "string" && PUBLIC_REVIEW_RESULTS.has(value.reviewResult)
    ? value.reviewResult as SpeedsterMeasuredDefect["reviewResult"]
    : null;
  const contour = Array.isArray(value.canonicalContour) ? value.canonicalContour.map(point) : [];
  let finalTrace: SpeedsterMeasuredDefect["finalTrace"];
  if (value.finalTrace !== undefined) {
    try {
      finalTrace = parseSpeedsterTraceRleV1(value.finalTrace);
    } catch {
      return null;
    }
  }
  const metrics = (measurement: unknown) => {
    if (!isRecord(measurement)) return null;
    const parsed = {
      ...(measurement.pixelCount !== undefined ? { pixelCount: number(measurement.pixelCount) } : {}),
      widthMm: number(measurement.widthMm),
      heightMm: number(measurement.heightMm),
      areaMm2: number(measurement.areaMm2),
      zonePercent: number(measurement.zonePercent),
      multiplier: number(measurement.multiplier),
      weightedAreaMm2: number(measurement.weightedAreaMm2),
      subgradeEffect: number(measurement.subgradeEffect),
    };
    return Object.values(parsed).some((entry) => entry === null || entry < 0) ? null : parsed;
  };
  if (!text(value.id) || !side || !defectType || !reviewResult || !text(value.sourceViewId)) return null;
  const confidence = number(value.confidence);
  if (confidence === null) return null;
  const supportingViewIds = Array.isArray(value.supportingViewIds)
    ? value.supportingViewIds.map(text).filter((entry): entry is string => Boolean(entry))
    : [];
  const common = {
    id: text(value.id)!,
    side,
    defectType,
    ...(origin ? { origin } : {}),
    ...(detectedDefectType ? { detectedDefectType } : {}),
    confidence,
    sourceViewId: text(value.sourceViewId)!,
    supportingViewIds,
    reviewResult,
  };
  if (finalTrace) {
    if (
      "zone" in value || "canonicalContour" in value || "measurement" in value ||
      !Array.isArray(value.measurementRegions)
    ) return null;
    const measurementRegions = value.measurementRegions.map((region) => {
      if (!isRecord(region)) return null;
      const regionZone = region.zone === "CORNERS" || region.zone === "EDGES" || region.zone === "SURFACE"
        ? region.zone
        : null;
      const regionContour = Array.isArray(region.canonicalContour) ? region.canonicalContour.map(point) : [];
      const measurement = metrics(region.measurement);
      return regionZone && regionContour.length >= 3 && !regionContour.some((entry) => !entry) && measurement
        ? { zone: regionZone, canonicalContour: regionContour as SpeedsterPoint[], measurement }
        : null;
    });
    if (measurementRegions.some((region) => !region)) return null;
    return {
      ...common,
      traceSha256: finalTrace.sha256,
      measurementRegions: measurementRegions as NonNullable<typeof measurementRegions[number]>[],
    } as SpeedsterReviewFinding;
  }
  const zone = value.zone === "CORNERS" || value.zone === "EDGES" || value.zone === "SURFACE" ? value.zone : null;
  const measurement = metrics(value.measurement);
  if (!zone || contour.length < 3 || contour.some((entry) => !entry) || !measurement) return null;
  return {
    ...common,
    zone,
    canonicalContour: contour as SpeedsterPoint[],
    measurement,
  } as SpeedsterMeasuredDefect;
}

function pair(value: unknown): readonly [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const first = number(value[0]);
  const second = number(value[1]);
  return first === null || second === null ? null : [first, second];
}

function gradeReport(value: unknown): Grade | null {
  if (!isRecord(value) || !isRecord(value.front) || !isRecord(value.back) || !isRecord(value.subgrades) || !isRecord(value.overall)) {
    return null;
  }
  const condition = (side: Record<string, unknown>, key: "corners" | "edges" | "surface") => {
    const row = isRecord(side[key]) ? side[key] : null;
    const score = row ? number(row.score) : null;
    const weightedDamagePercent = row ? number(row.weightedDamagePercent) : null;
    return score === null || weightedDamagePercent === null ? null : { score, weightedDamagePercent };
  };
  const side = (source: Record<string, unknown>) => {
    const centering = isRecord(source.centering) ? source.centering : null;
    const centeringScore = centering ? number(centering.score) : null;
    const leftRightBalance = centering ? pair(centering.leftRightBalance) : null;
    const topBottomBalance = centering ? pair(centering.topBottomBalance) : null;
    const corners = condition(source, "corners");
    const edges = condition(source, "edges");
    const surface = condition(source, "surface");
    return centeringScore === null || !leftRightBalance || !topBottomBalance || !corners || !edges || !surface
      ? null
      : { centering: { score: centeringScore, leftRightBalance, topBottomBalance }, corners, edges, surface };
  };
  const front = side(value.front);
  const back = side(value.back);
  const subgrades = {
    centering: number(value.subgrades.centering),
    corners: number(value.subgrades.corners),
    edges: number(value.subgrades.edges),
    surface: number(value.subgrades.surface),
  };
  const rawGrade = number(value.overall.rawGrade);
  const displayGrade = number(value.overall.displayGrade);
  if (!front || !back || Object.values(subgrades).some((entry) => entry === null) || rawGrade === null || displayGrade === null) return null;
  return {
    front,
    back,
    subgrades: subgrades as Grade["subgrades"],
    overall: { rawGrade, displayGrade },
  };
}

function sourceKeys(value: unknown): SourceKeys | null {
  if (!isRecord(value)) return null;
  const side = (name: SpeedsterCardSide) => {
    const candidate = value[name.toLowerCase()];
    const row: Record<string, unknown> | null = isRecord(candidate) ? candidate : null;
    const rectified = row ? text(row.rectifiedStorageKey) : null;
    const inspection = row ? text(row.inspectionStorageKey) : null;
    const parsedFrame = row ? parseSpeedsterInspectionFrame(row.inspectionFrame) : null;
    if (inspection && !parsedFrame) return null;
    const original = inspection ?? rectified;
    const master = (row ? text(row.reportStorageKey) : null) ?? original;
    const generated = row && isRecord(row.viewStorageKeys) ? row.viewStorageKeys : null;
    const normalized = generated ? text(generated.NORMALIZED) : null;
    const micro = generated ? text(generated.MICRO_DEFECT) : null;
    const directional = generated ? text(generated.DIRECTIONAL) : null;
    return master && original && normalized && micro && directional ? {
      master,
      inspectionFrame: parsedFrame ?? SPEEDSTER_CANONICAL_FRAME,
      views: { ORIGINAL: original, NORMALIZED: normalized, MICRO_DEFECT: micro, DIRECTIONAL: directional },
    } : null;
  };
  const front = side("FRONT");
  const back = side("BACK");
  return front && back ? { FRONT: front, BACK: back } : null;
}

export function mapCompletedSpeedsterSession(value: unknown): PublicReportSource | null {
  if (!isRecord(value) || value.workflowState !== "COMPLETED" || !isRecord(value.identity)) return null;
  const cardProfile = value.cardProfile === "POKEMON" || value.cardProfile === "SPORTS" ? value.cardProfile : null;
  const grade = gradeReport(value.gradeReport);
  const keys = sourceKeys(value.capture);
  const publicReportSlug = text(value.publicReportSlug);
  if (!cardProfile || !grade || !keys || !publicReportSlug || !Array.isArray(value.reviewedDefects)) return null;
  const defects = value.reviewedDefects
    .filter((entry): entry is Record<string, unknown> => (
      isRecord(entry) &&
      typeof entry.reviewResult === "string" &&
      PUBLIC_REVIEW_RESULTS.has(entry.reviewResult)
    ))
    .map(measuredDefect);
  if (defects.some((entry) => !entry)) return null;
  const identity: PublicIdentity = { cardProfile };
  for (const field of IDENTITY_FIELDS) {
    const fieldValue = text(value.identity[field]);
    if (fieldValue) identity[field] = fieldValue;
  }
  return {
    publicReportSlug,
    identity,
    defects: defects as SpeedsterReviewFinding[],
    grade,
    sourceKeys: keys,
    slabKeys: { front: text(value.slabFrontKey), back: text(value.slabBackKey) },
  };
}

export async function materializeSpeedsterReport(
  source: PublicReportSource,
  presign: ReportDependencies["presign"],
): Promise<PublicReportProps> {
  const imageUrls = {} as Record<SpeedsterCardSide, { master: string; views: Record<string, string> }>;
  await Promise.all((["FRONT", "BACK"] as const).map(async (side) => {
    const [master, ...values] = await Promise.all([
      presign(source.sourceKeys[side].master),
      ...VIEW_TYPES.map((view) => presign(source.sourceKeys[side].views[view])),
    ]);
    imageUrls[side] = {
      master,
      views: Object.fromEntries(VIEW_TYPES.map((view, index) => [view, values[index]])),
    };
  }));
  const [frontSlab, backSlab] = await Promise.all([
    source.slabKeys.front ? presign(source.slabKeys.front) : null,
    source.slabKeys.back ? presign(source.slabKeys.back) : null,
  ]);
  return {
    publicReportSlug: source.publicReportSlug,
    identity: source.identity,
    defects: source.defects,
    grade: source.grade,
    imageUrls,
    slabImageUrls: { front: frontSlab, back: backSlab },
    inspectionFrames: {
      FRONT: source.sourceKeys.FRONT.inspectionFrame,
      BACK: source.sourceKeys.BACK.inspectionFrame,
    },
  };
}

export function createSpeedsterReportGetServerSideProps(deps: ReportDependencies): GetServerSideProps<PublicReportProps> {
  return async function getServerSideProps(context: GetServerSidePropsContext) {
    context.res.setHeader("Cache-Control", "private, no-store");
    const slug = typeof context.params?.slug === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(context.params.slug)
      ? context.params.slug
      : null;
    if (!slug) return { notFound: true };
    const source = mapCompletedSpeedsterSession(await deps.findCompletedSession(slug));
    return source ? { props: await materializeSpeedsterReport(source, deps.presign) } : { notFound: true };
  };
}

export const getServerSideProps: GetServerSideProps<PublicReportProps> = async (context) => {
  const [{ prisma }, { presignReadUrl }] = await Promise.all([
    import("@tenkings/database"),
    import("../../../lib/server/storage"),
  ]);
  return createSpeedsterReportGetServerSideProps({
    findCompletedSession: (slug) => prisma.aiGraderV2Session.findFirst({
      where: { publicReportSlug: slug, workflowState: "COMPLETED" },
      select: {
        publicReportSlug: true,
        cardProfile: true,
        workflowState: true,
        identity: true,
        capture: true,
        reviewedDefects: true,
        gradeReport: true,
        slabFrontKey: true,
        slabBackKey: true,
      },
    }),
    presign: (storageKey) => presignReadUrl(storageKey, 60 * 60 * 24 * 7),
  })(context);
};

export default function SpeedsterPublicReport({
  publicReportSlug,
  identity,
  defects,
  grade,
  imageUrls,
  inspectionFrames,
  slabImageUrls,
}: PublicReportProps) {
  const [side, setSide] = useState<SpeedsterCardSide>("FRONT");
  const loadTrace = useCallback(async (findingId: string) => {
    const response = await fetch(
      `/api/ai-grader-v2/reports/${encodeURIComponent(publicReportSlug)}/trace?findingId=${encodeURIComponent(findingId)}`,
      { cache: "no-store" },
    );
    const payload = (await response.json().catch(() => ({}))) as { traceWire?: unknown };
    if (!response.ok || !payload.traceWire) return null;
    return encodeSpeedsterTraceRleV1(decodeSpeedsterTraceBitmapWireV1(payload.traceWire));
  }, [publicReportSlug]);
  const title = (identity.cardProfile === "POKEMON" ? identity.cardName : identity.playerName) || "Ten Kings card";
  const details = [identity.year, identity.manufacturer, identity.productSet, identity.parallel, identity.insert, identity.cardNumber]
    .filter(Boolean)
    .join(" · ");

  return (
    <main className={styles.page}>
      <Head>
        <title>{title} · Grade {grade.overall.displayGrade.toFixed(1)} | Ten Kings</title>
      </Head>
      <header className={styles.hero}>
        <Link className={styles.brand} href="/">TEN KINGS</Link>
        <div className={styles.identity}>
          <span>AI GRADED · MEASURED EVIDENCE</span>
          <h1>{title}</h1>
          {details ? <p>{details}</p> : null}
        </div>
        <div className={styles.grade}><small>FINAL GRADE</small><strong>{grade.overall.displayGrade.toFixed(1)}</strong></div>
      </header>

      <section className={styles.evidence}>
        <header className={styles.evidenceHeader}>
          <div><span>INTERACTIVE REPORT</span><h2>Every measurement. Right where it happened.</h2></div>
          <div className={styles.sides} aria-label="Card side">
            {(["FRONT", "BACK"] as const).map((value) => (
              <button key={value} type="button" className={side === value ? styles.active : undefined} onClick={() => setSide(value)}>
                {value === "FRONT" ? "Front" : "Back"}
              </button>
            ))}
          </div>
        </header>
        <DefectEvidenceViewer
          key={side}
          masterImageUrl={imageUrls[side].master}
          magnifyImageUrl={imageUrls[side].views.ORIGINAL}
          inspectionFrame={inspectionFrames[side]}
          sourceImageUrls={imageUrls[side].views}
          side={side}
          defects={defects}
          readOnly
          onTraceLoad={loadTrace}
        />
      </section>

      <GradeSummary grade={grade} />
      {slabImageUrls.front || slabImageUrls.back ? (
        <section className={styles.slabPhotos}>
          <header><span>SEALED CARD</span><h2>The finished Ten Kings slab.</h2></header>
          <div>
            {slabImageUrls.front ? <figure><img src={slabImageUrls.front} alt="Front of sealed Ten Kings slab" /><figcaption>Front</figcaption></figure> : null}
            {slabImageUrls.back ? <figure><img src={slabImageUrls.back} alt="Back of sealed Ten Kings slab" /><figcaption>Back</figcaption></figure> : null}
          </div>
        </section>
      ) : null}
      <footer className={styles.footer}><span>TEN KINGS</span><p>Measured. Transparent. Built to be inspected.</p></footer>
    </main>
  );
}

export type { PublicReportProps, PublicReportSource };
