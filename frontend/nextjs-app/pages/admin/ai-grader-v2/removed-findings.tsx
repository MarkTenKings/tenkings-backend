import Head from "next/head";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import AppShell from "../../../components/AppShell";
import { DefectEvidenceViewer } from "../../../components/ai-grader-v2/DefectEvidenceViewer";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../../constants/admin";
import { useSession } from "../../../hooks/useSession";
import { buildAdminHeaders } from "../../../lib/adminHeaders";
import type {
  SpeedsterCardSide,
  SpeedsterDefectOrigin,
  SpeedsterReviewFinding,
} from "../../../lib/ai-grader-v2/contracts";
import type { SpeedsterInspectionFrame } from "../../../lib/ai-grader-v2/inspection-frame";
import styles from "../../../styles/AiGraderV2RemovedFindings.module.css";

type OriginCounts = Record<SpeedsterDefectOrigin, number>;

type AuditCard = {
  id: string;
  cardProfile: string;
  certificateNumber: string | null;
  title: string;
  details: string[];
  createdAt: string;
  lifecycleState: string | null;
  publicReportSlug: string | null;
  workflowState: string;
  dataStatus: "AVAILABLE" | "UNREADABLE";
  removedCount: number;
  humanRemovedCount: number;
  filterRemovedCount: number;
  restoredFilterCount: number;
  removedByOrigin: OriginCounts;
};

type AuditSummary = {
  sessionsInspected: number;
  completedSessionsInspected: number;
  sessionsWithRemovedFindings: number;
  unreadableSessions: number;
  totalRemovedFindings: number;
  totalHumanRemovedFindings: number;
  totalFilterRemovedFindings: number;
  restoredFilterFindings: number;
  removedByOrigin: OriginCounts;
  truncated: boolean;
};

type RemovedFinding = SpeedsterReviewFinding & {
  removalClass: "HUMAN_REMOVED" | "FILTER_REMOVED";
  decisionId?: string;
  dataStatus?: "AVAILABLE" | "UNREADABLE";
  zones: string[];
  totalAreaMm2: number;
  similarity?: number | null;
  generatingExemplar?: {
    lessonSessionId: string;
    lessonCompletionOrder: number;
    lessonProposalOrder: number;
    lessonOrder: number;
    lessonSourceViewId: string;
    similarity: number;
  } | null;
  mapId?: string;
  mapRevisionId?: string;
  zoneId?: string;
  zoneLabel?: string;
  zoneType?: string;
  zoneOverlap?: { coveredVertices: number; totalVertices: number; ratio: number };
  filterPolicyVersion?: string;
  ruleId?: string;
  ruleInputs?: unknown;
  detectorVersion?: string;
  filteredAt?: string;
  restore?: {
    restored: boolean;
    restoredAt?: string;
    sessionLifecycleState?: string;
    outcome?: string;
  };
};

type SideEvidence = {
  masterImageUrl: string;
  sourceImageUrls: Record<string, string>;
  inspectionFrame: SpeedsterInspectionFrame;
};

type AuditDetail = {
  card: AuditCard;
  removedFindings: RemovedFinding[];
  evidence: {
    status: "AVAILABLE" | "UNAVAILABLE";
    cornerShape: "SQUARE" | "ROUNDED_3_18_MM";
    sides: Record<SpeedsterCardSide, SideEvidence> | null;
  };
};

const ORIGIN_LABELS: Record<SpeedsterDefectOrigin, string> = {
  DETECTOR: "Detector",
  MEMORY: "Memory",
  SMART_MARK: "Smart-Mark",
};

const displayType = (value: string) => value.toLowerCase().replaceAll("_", " ");

type FilterField = "removalClass" | "mapId" | "mapRevisionId" | "zoneId" | "cardProfile" | "side" | "origin" | "defectType" | "sourceViewId" | "restored";
const FILTER_LABELS: Record<FilterField, string> = {
  removalClass: "Removal class",
  mapId: "Map",
  mapRevisionId: "Map revision",
  zoneId: "Zone",
  cardProfile: "Card type",
  side: "Side",
  origin: "Origin",
  defectType: "Defect type",
  sourceViewId: "View",
  restored: "Restore state",
};

export default function RemovedSpeedsterFindingsPage() {
  const { session, loading, ensureSession } = useSession();
  const [summary, setSummary] = useState<AuditSummary | null>(null);
  const [cards, setCards] = useState<AuditCard[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AuditDetail | null>(null);
  const [side, setSide] = useState<SpeedsterCardSide>("FRONT");
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [showAllCards, setShowAllCards] = useState(false);
  const [filters, setFilters] = useState<Partial<Record<FilterField, string>>>({});
  const [groupBy, setGroupBy] = useState<FilterField | "none">("removalClass");
  const [restoringDecisionId, setRestoringDecisionId] = useState<string | null>(null);
  const [message, setMessage] = useState("Loading saved removed findings.");
  const isAdmin = useMemo(
    () => hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone),
    [session?.user.id, session?.user.phone],
  );

  useEffect(() => {
    if (!session?.token || !isAdmin) return;
    let active = true;
    void fetch("/api/admin/ai-grader-v2/removed-findings", {
      headers: buildAdminHeaders(session.token),
    }).then(async (response) => {
      const payload = await response.json().catch(() => ({})) as {
        summary?: AuditSummary;
        cards?: AuditCard[];
        message?: string;
      };
      if (!response.ok || !payload.summary || !payload.cards) {
        throw new Error(payload.message ?? "Removed findings could not be loaded.");
      }
      if (!active) return;
      setSummary(payload.summary);
      setCards(payload.cards);
      const first = payload.cards.find(({ removedCount }) => removedCount > 0) ?? payload.cards[0];
      setSelectedSessionId(first?.id ?? null);
      setMessage(payload.summary.totalRemovedFindings > 0
        ? `${payload.summary.totalRemovedFindings} saved removed findings across ${payload.summary.sessionsWithRemovedFindings} card sessions.`
        : "No saved removed findings were found.");
    }).catch((error) => {
      if (active) setMessage(error instanceof Error ? error.message : "Removed findings could not be loaded.");
    });
    return () => { active = false; };
  }, [isAdmin, session?.token]);

  useEffect(() => {
    if (!session?.token || !isAdmin || !selectedSessionId) return;
    let active = true;
    setDetail(null);
    setSelectedFindingId(null);
    void fetch(
      `/api/admin/ai-grader-v2/removed-findings?sessionId=${encodeURIComponent(selectedSessionId)}`,
      { headers: buildAdminHeaders(session.token) },
    ).then(async (response) => {
      const payload = await response.json().catch(() => ({})) as AuditDetail & { message?: string };
      if (!response.ok || !payload.card || !Array.isArray(payload.removedFindings)) {
        throw new Error(payload.message ?? "This card’s removed findings could not be loaded.");
      }
      if (!active) return;
      setDetail(payload);
      const preferredSide = payload.removedFindings.some((finding) => finding.side === "FRONT") ? "FRONT" : "BACK";
      setSide(preferredSide);
      setSelectedFindingId(payload.removedFindings.find((finding) => finding.side === preferredSide)?.id ?? null);
    }).catch((error) => {
      if (active) setMessage(error instanceof Error ? error.message : "This card’s removed findings could not be loaded.");
    });
    return () => { active = false; };
  }, [isAdmin, selectedSessionId, session?.token]);

  const listedCards = useMemo(() => showAllCards
    ? cards
    : cards.filter(({ removedCount, dataStatus }) => removedCount > 0 || dataStatus === "UNREADABLE"),
  [cards, showAllCards]);
  const filterOptions = useMemo(() => {
    const findings = detail?.removedFindings ?? [];
    const value = (finding: RemovedFinding, field: FilterField) => {
      if (field === "cardProfile") return detail?.card.cardProfile ?? "";
      if (field === "restored") return finding.removalClass === "FILTER_REMOVED"
        ? (finding.restore?.restored ? "RESTORED" : "UNRESTORED")
        : "NOT_APPLICABLE";
      return String((finding as unknown as Record<string, unknown>)[field] ?? "");
    };
    return Object.fromEntries((Object.keys(FILTER_LABELS) as FilterField[]).map((field) => [
      field,
      [...new Set(findings.map((finding) => value(finding, field)).filter(Boolean))].sort(),
    ])) as Record<FilterField, string[]>;
  }, [detail?.card.cardProfile, detail?.removedFindings]);
  const filteredFindings = useMemo(() => (detail?.removedFindings ?? []).filter((finding) => {
    return (Object.entries(filters) as [FilterField, string][]).every(([field, selected]) => {
      if (!selected) return true;
      if (field === "cardProfile") return detail?.card.cardProfile === selected;
      if (field === "restored") {
        const state = finding.removalClass === "FILTER_REMOVED"
          ? (finding.restore?.restored ? "RESTORED" : "UNRESTORED")
          : "NOT_APPLICABLE";
        return state === selected;
      }
      return String((finding as unknown as Record<string, unknown>)[field] ?? "") === selected;
    });
  }), [detail?.card.cardProfile, detail?.removedFindings, filters]);
  const sideFindings = useMemo(() => filteredFindings.filter((finding) =>
    finding.side === side && finding.dataStatus !== "UNREADABLE"), [filteredFindings, side]);
  const groupedFindings = useMemo(() => {
    if (groupBy === "none") return [["All findings", filteredFindings] as const];
    const groups = new Map<string, RemovedFinding[]>();
    for (const finding of filteredFindings) {
      const key = groupBy === "cardProfile"
        ? detail?.card.cardProfile ?? "Not applicable"
        : groupBy === "restored"
        ? (finding.removalClass === "FILTER_REMOVED"
            ? (finding.restore?.restored ? "RESTORED" : "UNRESTORED")
            : "NOT_APPLICABLE")
        : String((finding as unknown as Record<string, unknown>)[groupBy] ?? "Not applicable");
      groups.set(key, [...(groups.get(key) ?? []), finding]);
    }
    return [...groups.entries()];
  }, [detail?.card.cardProfile, filteredFindings, groupBy]);
  const sideEvidence = detail?.evidence.sides?.[side] ?? null;

  const restoreFinding = async (finding: RemovedFinding) => {
    if (!session?.token || !finding.decisionId || finding.restore?.restored) return;
    setRestoringDecisionId(finding.decisionId);
    try {
      const response = await fetch(
        `/api/admin/ai-grader-v2/removed-findings/${encodeURIComponent(finding.decisionId)}/restore`,
        { method: "POST", headers: buildAdminHeaders(session.token) },
      );
      const payload = await response.json().catch(() => ({})) as {
        message?: string;
        outcome?: string;
        restoredAt?: string;
      };
      if (!response.ok || !payload.outcome || !payload.restoredAt) {
        throw new Error(payload.message ?? "The filtered finding could not be restored.");
      }
      setDetail((current) => current ? {
        ...current,
        removedFindings: current.removedFindings.map((candidate) =>
          candidate.decisionId === finding.decisionId
            ? {
                ...candidate,
                restore: {
                  restored: true,
                  restoredAt: payload.restoredAt,
                  outcome: payload.outcome,
                  sessionLifecycleState: current.card.workflowState,
                },
              }
            : candidate),
      } : current);
      setMessage(payload.outcome === "ACTIVE_REINTRODUCED"
        ? "Finding restored to active review and regraded through the existing authority."
        : "Completed-card calibration mistake recorded. Historical grade, findings, report, label, card, and updatedAt were not rewritten.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The filtered finding could not be restored.");
    } finally {
      setRestoringDecisionId(null);
    }
  };

  if (loading) return <AppShell background="black"><div className={styles.center}>Loading Speedster…</div></AppShell>;
  if (!session) return <AppShell background="black"><div className={styles.center}><button onClick={() => void ensureSession()}>Sign in to Speedster</button></div></AppShell>;
  if (!isAdmin) return <AppShell background="black"><div className={styles.center}>Admin access required.</div></AppShell>;

  return (
    <AppShell background="black" hideFooter>
      <Head><title>Removed Defects Audit | Speedster</title><meta name="robots" content="noindex,nofollow" /></Head>
      <main className={styles.page}>
        <header className={styles.hero}>
          <div>
            <span>TEN KINGS · PRIVATE FILTER AUDIT</span>
            <h1>Removed defects.</h1>
            <p>{message}</p>
          </div>
          <nav>
            <Link href="/admin/ai-grader-v2/completed">Graded cards</Link>
            <Link href="/admin/ai-grader-v2">New card</Link>
          </nav>
        </header>

        {summary ? <section className={styles.summary} aria-label="Removed defect totals">
          <div><small>SESSIONS INSPECTED</small><strong>{summary.sessionsInspected}</strong></div>
          <div><small>CARDS WITH REMOVALS</small><strong>{summary.sessionsWithRemovedFindings}</strong></div>
          <div><small>HUMAN_REMOVED</small><strong>{summary.totalHumanRemovedFindings}</strong></div>
          <div><small>FILTER_REMOVED</small><strong>{summary.totalFilterRemovedFindings}</strong></div>
          <div><small>FILTER RESTORED</small><strong>{summary.restoredFilterFindings}</strong></div>
          <div><small>ALL REMOVALS</small><strong>{summary.totalRemovedFindings}</strong></div>
        </section> : null}

        {summary?.unreadableSessions ? <p className={styles.warning} role="alert">
          {summary.unreadableSessions} session{summary.unreadableSessions === 1 ? " has" : "s have"} saved review data that could not be parsed. Nothing was silently omitted.
        </p> : null}
        {summary?.truncated ? <p className={styles.warning} role="alert">
          This view reached its 500-session safety limit. The displayed totals are incomplete.
        </p> : null}

        <section className={styles.auditGrid}>
          <aside className={styles.cardRail} aria-label="Card sessions with removed findings">
            <header>
              <div><small>CARD RECORDS</small><strong>{listedCards.length}</strong></div>
              <button type="button" onClick={() => setShowAllCards((value) => !value)}>
                {showAllCards ? "Only removals" : "Show all records"}
              </button>
            </header>
            <div className={styles.cardButtons}>
              {listedCards.map((card) => <button
                type="button"
                key={card.id}
                className={card.id === selectedSessionId ? styles.selectedCard : undefined}
                onClick={() => setSelectedSessionId(card.id)}
              >
                <span>{card.certificateNumber ?? "LABEL READY"} · {card.cardProfile}</span>
                <strong>{card.title}</strong>
                <small>{card.dataStatus === "UNREADABLE"
                  ? "Saved review data unreadable"
                  : `${card.removedCount} removed · Human ${card.humanRemovedCount} · Filter ${card.filterRemovedCount} · Restored ${card.restoredFilterCount}`}</small>
              </button>)}
            </div>
          </aside>

          <article className={styles.detailPanel}>
            {!detail ? <div className={styles.empty}>Select a card session to inspect its saved removed findings.</div> : <>
              <header className={styles.cardHeader}>
                <div>
                  <span>{detail.card.certificateNumber ?? "LABEL READY"} · {detail.card.cardProfile}</span>
                  <h2>{detail.card.title}</h2>
                  <p>{detail.card.details.join(" · ")}</p>
                  <p>Session {detail.card.id} · {displayType(detail.card.workflowState)}</p>
                </div>
                <div className={styles.cardHeaderActions}>
                  {detail.card.workflowState === "COMPLETED"
                    ? <Link href={`/admin/ai-grader-v2/completed/${encodeURIComponent(detail.card.id)}`}>Open completed card</Link>
                    : <span>Active Speedster session</span>}
                  {(["FRONT", "BACK"] as const).map((value) => <button
                    type="button"
                    key={value}
                    className={side === value ? styles.activeSide : undefined}
                    onClick={() => {
                      setSide(value);
                      setSelectedFindingId(detail.removedFindings.find((finding) => finding.side === value)?.id ?? null);
                    }}
                  >{value === "FRONT" ? "Front" : "Back"}</button>)}
                </div>
              </header>

              {sideEvidence ? <DefectEvidenceViewer
                key={`${detail.card.id}:${side}`}
                masterImageUrl={sideEvidence.masterImageUrl}
                magnifyImageUrl={sideEvidence.sourceImageUrls[`${side}:ORIGINAL`]}
                inspectionFrame={sideEvidence.inspectionFrame}
                sourceImageUrls={sideEvidence.sourceImageUrls}
                cornerShape={detail.evidence.cornerShape}
                side={side}
                defects={sideFindings}
                readOnly
                selectedDefectId={selectedFindingId}
                onSelectedDefectChange={setSelectedFindingId}
              /> : <div className={styles.evidenceUnavailable}>
                Saved finding details are available, but this card&apos;s inspection images could not be opened.
              </div>}

              <section className={styles.filters} aria-label="Removed finding filters">
                {(Object.keys(FILTER_LABELS) as FilterField[]).map((field) => <label key={field}>
                  <span>{FILTER_LABELS[field]}</span>
                  <select value={filters[field] ?? ""} onChange={(event) => setFilters((current) => ({
                    ...current,
                    [field]: event.target.value,
                  }))}>
                    <option value="">All</option>
                    {filterOptions[field].map((value) => <option key={value} value={value}>{displayType(value)}</option>)}
                  </select>
                </label>)}
                <label>
                  <span>Group by</span>
                  <select value={groupBy} onChange={(event) => setGroupBy(event.target.value as FilterField | "none")}>
                    <option value="none">No grouping</option>
                    {(Object.keys(FILTER_LABELS) as FilterField[]).map((field) =>
                      <option key={field} value={field}>{FILTER_LABELS[field]}</option>)}
                  </select>
                </label>
              </section>

              <section className={styles.findingList} aria-label="Filtered and human removed findings">
                <header><span>FILTERED RESULTS</span><strong>{filteredFindings.length} removed finding{filteredFindings.length === 1 ? "" : "s"}</strong></header>
                {filteredFindings.length === 0 ? <p>No saved removed findings match these filters.</p> : groupedFindings.map(([group, findings]) => <div className={styles.findingGroup} key={group}>
                  {groupBy !== "none" ? <h3>{displayType(group)} · {findings.length}</h3> : null}
                  {findings.map((finding, index) => <div
                    key={`${finding.removalClass}:${finding.decisionId ?? finding.id}`}
                    className={finding.id === selectedFindingId ? styles.selectedFinding : undefined}
                  >
                    <button type="button" onClick={() => {
                      setSide(finding.side);
                      setSelectedFindingId(finding.id);
                    }}>
                      <span className={finding.removalClass === "FILTER_REMOVED" ? styles.filterBadge : styles.humanBadge}>
                        {finding.removalClass}
                      </span>
                      <small>#{index + 1} · {ORIGIN_LABELS[finding.origin ?? "DETECTOR"]}</small>
                      <strong>{displayType(finding.defectType)}</strong>
                      <small>{finding.zones.join(" · ")} · {finding.sourceViewId} · {finding.totalAreaMm2.toFixed(3)} mm²</small>
                      {finding.dataStatus === "UNREADABLE" ? <small>Saved candidate snapshot is unreadable; permanent decision evidence remains available.</small> : null}
                      {finding.detectedDefectType && finding.detectedDefectType !== finding.defectType
                        ? <small>Originally proposed as {displayType(finding.detectedDefectType)}</small>
                        : null}
                      {finding.memoryProposal ? <small>
                        Similarity {finding.memoryProposal.similarity.toFixed(3)} · exemplar session {finding.memoryProposal.lessonSessionId} · completion {finding.memoryProposal.lessonCompletionOrder} · proposal {finding.memoryProposal.lessonProposalOrder} · source {finding.memoryProposal.lessonSourceViewId}
                      </small> : null}
                      {finding.removalClass === "FILTER_REMOVED" ? <>
                        <small>Session {detail.card.id} · {displayType(detail.card.cardProfile)} · {finding.side}</small>
                        <small>Confidence {finding.confidence.toFixed(3)}{finding.similarity != null ? ` · similarity ${finding.similarity.toFixed(3)}` : ""}</small>
                        {finding.generatingExemplar ? <small>Generating exemplar {finding.generatingExemplar.lessonSessionId} · completion {finding.generatingExemplar.lessonCompletionOrder} · proposal {finding.generatingExemplar.lessonProposalOrder} · source {finding.generatingExemplar.lessonSourceViewId}</small> : null}
                        <small>Source {finding.sourceViewId} · supporting {finding.supportingViewIds.length ? finding.supportingViewIds.join(", ") : "none"}</small>
                        <small>Map {finding.mapId} · revision {finding.mapRevisionId}</small>
                        <small>Zone {finding.zoneLabel} ({displayType(finding.zoneType ?? "")}) · overlap {finding.zoneOverlap?.coveredVertices}/{finding.zoneOverlap?.totalVertices}</small>
                        <small>Rule {finding.ruleId} · policy {finding.filterPolicyVersion} · filtered {finding.filteredAt ? new Date(finding.filteredAt).toLocaleString() : "unknown"}</small>
                        <small>{finding.restore?.restored
                          ? `Restored while ${displayType(finding.restore.sessionLifecycleState ?? "unknown")} · ${finding.restore.restoredAt ? new Date(finding.restore.restoredAt).toLocaleString() : ""}`
                          : "Unrestored"}</small>
                      </> : null}
                    </button>
                    {finding.removalClass === "FILTER_REMOVED" && !finding.restore?.restored ? <button
                      type="button"
                      className={styles.restoreButton}
                      disabled={restoringDecisionId === finding.decisionId}
                      onClick={() => void restoreFinding(finding)}
                    >{restoringDecisionId === finding.decisionId ? "Restoring…" : "Restore"}</button> : null}
                  </div>)}
                </div>)}
              </section>
            </>}
          </article>
        </section>
      </main>
    </AppShell>
  );
}
