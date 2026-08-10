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
  dataStatus: "AVAILABLE" | "UNREADABLE";
  removedCount: number;
  removedByOrigin: OriginCounts;
};

type AuditSummary = {
  completedSessionsInspected: number;
  sessionsWithRemovedFindings: number;
  unreadableSessions: number;
  totalRemovedFindings: number;
  removedByOrigin: OriginCounts;
  truncated: boolean;
};

type RemovedFinding = SpeedsterReviewFinding & {
  zones: string[];
  totalAreaMm2: number;
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

export default function RemovedSpeedsterFindingsPage() {
  const { session, loading, ensureSession } = useSession();
  const [summary, setSummary] = useState<AuditSummary | null>(null);
  const [cards, setCards] = useState<AuditCard[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AuditDetail | null>(null);
  const [side, setSide] = useState<SpeedsterCardSide>("FRONT");
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [showAllCards, setShowAllCards] = useState(false);
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
        ? `${payload.summary.totalRemovedFindings} saved removed findings across ${payload.summary.sessionsWithRemovedFindings} completed cards.`
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
  const sideFindings = detail?.removedFindings.filter((finding) => finding.side === side) ?? [];
  const sideEvidence = detail?.evidence.sides?.[side] ?? null;

  if (loading) return <AppShell background="black"><div className={styles.center}>Loading Speedster…</div></AppShell>;
  if (!session) return <AppShell background="black"><div className={styles.center}><button onClick={() => void ensureSession()}>Sign in to Speedster</button></div></AppShell>;
  if (!isAdmin) return <AppShell background="black"><div className={styles.center}>Admin access required.</div></AppShell>;

  return (
    <AppShell background="black" hideFooter>
      <Head><title>Removed Defects Audit | Speedster</title><meta name="robots" content="noindex,nofollow" /></Head>
      <main className={styles.page}>
        <header className={styles.hero}>
          <div>
            <span>TEN KINGS · PRIVATE READ-ONLY AUDIT</span>
            <h1>Removed defects.</h1>
            <p>{message}</p>
          </div>
          <nav>
            <Link href="/admin/ai-grader-v2/completed">Completed cards</Link>
            <Link href="/admin/ai-grader-v2">New card</Link>
          </nav>
        </header>

        {summary ? <section className={styles.summary} aria-label="Removed defect totals">
          <div><small>COMPLETED INSPECTED</small><strong>{summary.completedSessionsInspected}</strong></div>
          <div><small>CARDS WITH REMOVALS</small><strong>{summary.sessionsWithRemovedFindings}</strong></div>
          <div><small>REMOVED FINDINGS</small><strong>{summary.totalRemovedFindings}</strong></div>
          <div><small>DETECTOR</small><strong>{summary.removedByOrigin.DETECTOR}</strong></div>
          <div><small>MEMORY</small><strong>{summary.removedByOrigin.MEMORY}</strong></div>
          <div><small>SMART-MARK</small><strong>{summary.removedByOrigin.SMART_MARK}</strong></div>
        </section> : null}

        {summary?.unreadableSessions ? <p className={styles.warning} role="alert">
          {summary.unreadableSessions} completed session{summary.unreadableSessions === 1 ? " has" : "s have"} saved review data that could not be parsed. Nothing was silently omitted.
        </p> : null}
        {summary?.truncated ? <p className={styles.warning} role="alert">
          This view reached its 500-session safety limit. The displayed totals are incomplete.
        </p> : null}

        <section className={styles.auditGrid}>
          <aside className={styles.cardRail} aria-label="Completed cards with removed findings">
            <header>
              <div><small>CARD RECORDS</small><strong>{listedCards.length}</strong></div>
              <button type="button" onClick={() => setShowAllCards((value) => !value)}>
                {showAllCards ? "Only removals" : "Show all completed"}
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
                  : `${card.removedCount} removed · D ${card.removedByOrigin.DETECTOR} · M ${card.removedByOrigin.MEMORY} · S ${card.removedByOrigin.SMART_MARK}`}</small>
              </button>)}
            </div>
          </aside>

          <article className={styles.detailPanel}>
            {!detail ? <div className={styles.empty}>Select a completed card to inspect its saved removed findings.</div> : <>
              <header className={styles.cardHeader}>
                <div>
                  <span>{detail.card.certificateNumber ?? "LABEL READY"} · {detail.card.cardProfile}</span>
                  <h2>{detail.card.title}</h2>
                  <p>{detail.card.details.join(" · ")}</p>
                </div>
                <div className={styles.cardHeaderActions}>
                  <Link href={`/admin/ai-grader-v2/completed/${encodeURIComponent(detail.card.id)}`}>Open completed card</Link>
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

              <section className={styles.findingList} aria-label={`${side.toLowerCase()} removed findings`}>
                <header><span>{side}</span><strong>{sideFindings.length} removed finding{sideFindings.length === 1 ? "" : "s"}</strong></header>
                {sideFindings.length === 0 ? <p>No saved removed findings on this side.</p> : sideFindings.map((finding, index) => <button
                  type="button"
                  key={finding.id}
                  className={finding.id === selectedFindingId ? styles.selectedFinding : undefined}
                  onClick={() => setSelectedFindingId(finding.id)}
                >
                  <span>#{index + 1} · {ORIGIN_LABELS[finding.origin ?? "DETECTOR"]}</span>
                  <strong>{displayType(finding.defectType)}</strong>
                  <small>{finding.zones.join(" · ")} · {finding.sourceViewId} · {finding.totalAreaMm2.toFixed(3)} mm²</small>
                  {finding.detectedDefectType && finding.detectedDefectType !== finding.defectType
                    ? <small>Originally proposed as {displayType(finding.detectedDefectType)}</small>
                    : null}
                  {finding.memoryProposal ? <small>
                    Similarity {finding.memoryProposal.similarity.toFixed(3)} · exemplar session {finding.memoryProposal.lessonSessionId} · completion {finding.memoryProposal.lessonCompletionOrder} · proposal {finding.memoryProposal.lessonProposalOrder} · source {finding.memoryProposal.lessonSourceViewId}
                  </small> : null}
                </button>)}
              </section>
            </>}
          </article>
        </section>
      </main>
    </AppShell>
  );
}
