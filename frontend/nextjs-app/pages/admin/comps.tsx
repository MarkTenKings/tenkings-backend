/* eslint-disable @next/next/no-img-element */
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useState } from "react";

import AppShell from "../../components/AppShell";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../constants/admin";
import { useSession } from "../../hooks/useSession";
import { buildAdminHeaders } from "../../lib/adminHeaders";
import {
  COMPS_V2_INITIAL_VISIBLE_COUNT,
  handleFetch30MoreCompsV2Click,
  initialCompsV2VisibleCount,
  isCompsV2QueryReadOnly,
  shouldAutoRunCompsV2Search,
  visibleCompsV2Candidates,
} from "../../lib/compsV2Ui";
import styles from "../../styles/CompsV2.module.css";

type Candidate = {
  id: string; title: string; listingUrl: string; imageUrl: string | null; soldPriceCents: number | null;
  soldDate: string | null; grader: string | null; numericGrade: number | null; raw: boolean;
  group: "PSA_TARGET" | "PSA_OTHER" | "OTHER_GRADED" | "RAW"; matchScore: number; matchReason: string; included: boolean;
};
type Snapshot = {
  query: string; nextOffset: number; hasMore: boolean; candidates: Candidate[];
  selection: { includedCount: number; averageSoldPriceCents: number | null; lowestSoldPriceCents: number | null; highestSoldPriceCents: number | null };
};
type ReviewProof = { version: 1; baseCompsStateRevision: string; expiresAt: string; snapshot: Snapshot; signature: string };
type Card = {
  id: string; publicToken: string; certificateNumber: string | null; category: "SPORTS" | "POKEMON";
  playerName: string | null; cardName: string | null; year: string; manufacturer: string | null; productSet: string;
  parallel: string | null; insert: string | null; cardNumber: string | null; targetGrade: number | null; psaTargetGrade: number | null;
  defaultQuery: string; imageUrl: string | null; snapshot: Snapshot | null; marketValueCents: number | null;
  compsPublic: boolean; compsStateRevision: string;
};
type CardSearch = { id: string; certificateNumber: string | null; name: string | null; details: string };

const GROUPS = [
  ["PSA_TARGET", "PSA — Same Grade"], ["PSA_OTHER", "PSA — Other Grades"],
  ["OTHER_GRADED", "BGS / SGC / CGC"], ["RAW", "Raw"],
] as const;
const money = (cents: number | null) => cents == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

export default function CompsV2Page() {
  const router = useRouter();
  const { session, loading, ensureSession } = useSession();
  const isAdmin = useMemo(() => hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone), [session?.user.id, session?.user.phone]);
  const [mode, setMode] = useState<"CARD" | "RESEARCH">("CARD");
  const [card, setCard] = useState<Card | null>(null);
  const [lookup, setLookup] = useState("");
  const [matches, setMatches] = useState<CardSearch[]>([]);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [compsPublic, setCompsPublic] = useState(false);
  const [research, setResearch] = useState({ category: "SPORTS", name: "", year: "", manufacturer: "", productSet: "", parallel: "", cardNumber: "", targetGrade: "" });
  const [busy, setBusy] = useState(false);
  const [visibleCount, setVisibleCount] = useState(COMPS_V2_INITIAL_VISIBLE_COUNT);
  const [autoAttemptedCardId, setAutoAttemptedCardId] = useState<string | null>(null);
  const [reviewProof, setReviewProof] = useState<ReviewProof | null>(null);
  const [message, setMessage] = useState("Select a permanent V2 card or search without a card.");
  const returnPath = typeof router.query.from === "string" && /^\/admin\/ai-grader-v2\/completed\/[a-z0-9-]{20,40}$/i.test(router.query.from)
    ? router.query.from
    : "/admin/ai-grader-v2/completed";

  const headers = useCallback((json = false) => session?.token ? buildAdminHeaders(session.token, json ? { "Content-Type": "application/json" } : undefined) : {}, [session?.token]);
  const adoptCard = useCallback((next: Card) => {
    setCard(next); setMode("CARD"); setQuery(next.snapshot?.query ?? next.defaultQuery);
    setCandidates(next.snapshot?.candidates ?? []);
    setSelected(next.snapshot?.candidates.filter(({ included }) => included).map(({ id }) => id) ?? []);
    setCompsPublic(next.compsPublic); setMatches([]);
    setReviewProof(null);
    setVisibleCount(initialCompsV2VisibleCount(next.snapshot?.selection.includedCount ?? 0));
  }, []);

  const loadCard = useCallback(async (id: string) => {
    if (!session?.token) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/v2/admin/comps/card?card=${encodeURIComponent(id)}`, { headers: headers() });
      const payload = await response.json().catch(() => ({})) as { card?: Card; message?: string };
      if (!response.ok || !payload.card) throw new Error(payload.message ?? "Card could not be loaded.");
      adoptCard(payload.card); setMessage(payload.card.snapshot ? "Saved sold-comps snapshot loaded." : "Card loaded. Find sold comps when ready.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Card could not be loaded."); }
    finally { setBusy(false); }
  }, [adoptCard, headers, session?.token]);

  useEffect(() => {
    const id = typeof router.query.card === "string" ? router.query.card : null;
    if (mode === "CARD" && id && session?.token && isAdmin && card?.id !== id) void loadCard(id);
  }, [card?.id, isAdmin, loadCard, mode, router.query.card, session?.token]);

  const findCards = async () => {
    if (!lookup.trim()) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/v2/admin/comps/cards?q=${encodeURIComponent(lookup.trim())}`, { headers: headers() });
      const payload = await response.json().catch(() => ({})) as { cards?: CardSearch[]; message?: string };
      if (!response.ok) throw new Error(payload.message ?? "Card search failed.");
      setMatches(payload.cards ?? []); setMessage(payload.cards?.length ? "Choose the exact permanent card." : "No matching permanent V2 cards.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Card search failed."); }
    finally { setBusy(false); }
  };

  const chooseCard = (id: string) => {
    setMode("CARD");
    setCard(null);
    setCandidates([]);
    setSelected([]);
    setQuery("");
    setReviewProof(null);
    setVisibleCount(COMPS_V2_INITIAL_VISIBLE_COUNT);
    setMessage("Loading the selected permanent card…");
    void router.push({
      pathname: "/admin/comps",
      query: { card: id, ...(returnPath !== "/admin/ai-grader-v2/completed" ? { from: returnPath } : {}) },
    });
  };

  const runSearch = async (operation: "FIND" | "REFRESH") => {
    if (!query.trim() || busy) return;
    const replacingSelection = selected.length > 0 || Boolean(card?.snapshot?.selection.includedCount);
    const acknowledgeReplaceSelected = !replacingSelection || window.confirm("Refresh will replace the current selected-comp snapshot. Continue?");
    if (!acknowledgeReplaceSelected) return;
    setBusy(true); setMessage("Searching eBay sold listings…");
    try {
      const body = mode === "CARD" && card ? {
        cardId: card.id, query: query.trim(), operation,
        expectedCompsStateRevision: card.compsStateRevision, acknowledgeReplaceSelected,
      } : {
        researchIdentity: {
          category: research.category,
          ...(research.category === "SPORTS" ? { playerName: research.name } : { cardName: research.name }),
          year: research.year, manufacturer: research.manufacturer || null, productSet: research.productSet,
          parallel: research.parallel || null, cardNumber: research.cardNumber || null,
          targetGrade: research.targetGrade ? Number(research.targetGrade) : null,
        }, query: query.trim(), operation,
      };
      const response = await fetch("/api/v2/admin/comps/search", { method: "POST", headers: headers(true), body: JSON.stringify(body) });
      const payload = await response.json().catch(() => ({})) as { mode?: string; card?: Card; result?: Snapshot; review?: ReviewProof; message?: string; code?: string };
      if (!response.ok) throw new Error(payload.message ?? "Sold comps search failed.");
      if (payload.card) {
        adoptCard(payload.card);
      }
      else if (payload.review) {
        setReviewProof(payload.review);
        setQuery(payload.review.snapshot.query);
        setCandidates(payload.review.snapshot.candidates);
        setSelected([]);
        setVisibleCount(COMPS_V2_INITIAL_VISIBLE_COUNT);
      }
      else if (payload.result) {
        setCandidates(payload.result.candidates);
        setSelected([]);
        setReviewProof(null);
        setVisibleCount(COMPS_V2_INITIAL_VISIBLE_COUNT);
      }
      setMessage(`Loaded ${payload.card?.snapshot?.candidates.length ?? payload.review?.snapshot.candidates.length ?? payload.result?.candidates.length ?? 0} sold results.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Sold comps search failed."); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    if (!shouldAutoRunCompsV2Search({
      mode,
      cardId: card?.id ?? null,
      hasSnapshot: Boolean(card?.snapshot),
      candidateCount: candidates.length,
      query,
      busy,
      autoAttemptedCardId,
    }) || !card) return;
    setAutoAttemptedCardId(card.id);
    void runSearch("FIND");
    // The automatic attempt is deliberately once per selected completed card.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAttemptedCardId, busy, candidates.length, card, mode, query]);

  const chosen = candidates.filter(({ id }) => selected.includes(id));
  const priced = chosen.filter((candidate) => candidate.soldPriceCents && candidate.soldPriceCents > 0);
  const average = priced.length ? Math.round(priced.reduce((sum, candidate) => sum + candidate.soldPriceCents!, 0) / priced.length) : null;

  const confirmValue = async () => {
    if (!card || busy) return;
    if (!average) { setMessage("Select at least one sold comp with a price."); return; }
    setBusy(true); setMessage("Confirming selected comps and market value…");
    try {
      const response = await fetch("/api/v2/admin/comps/confirm", { method: "POST", headers: headers(true), body: JSON.stringify({
        cardId: card.id, expectedCompsStateRevision: card.compsStateRevision,
        selectedCandidateIds: selected, compsPublic,
        ...(reviewProof ? { reviewProof } : {}),
      }) });
      const payload = await response.json().catch(() => ({})) as { card?: Card; message?: string };
      if (!response.ok || !payload.card) throw new Error(payload.message ?? "Market value could not be confirmed.");
      adoptCard(payload.card); setMessage("Market value and selected sold comps confirmed.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Market value could not be confirmed."); }
    finally { setBusy(false); }
  };

  const savePublic = async () => {
    if (!card || busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/v2/admin/comps/public", { method: "POST", headers: headers(true), body: JSON.stringify({
        cardId: card.id, expectedCompsStateRevision: card.compsStateRevision, compsPublic,
      }) });
      const payload = await response.json().catch(() => ({})) as { card?: Card; message?: string };
      if (!response.ok || !payload.card) throw new Error(payload.message ?? "Public setting could not be saved.");
      adoptCard(payload.card); setMessage("Public comps setting saved.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Public setting could not be saved."); }
    finally { setBusy(false); }
  };

  if (loading) return <AppShell background="black"><div className={styles.page}>Loading…</div></AppShell>;
  if (!session) return <AppShell background="black"><div className={styles.page}><button className={styles.button} onClick={() => void ensureSession()}>Sign in</button></div></AppShell>;
  if (!isAdmin) return <AppShell background="black"><div className={styles.page}>Admin access required.</div></AppShell>;

  return <AppShell background="black" hideFooter>
    <Head><title>eBay Sold Comps | Ten Kings</title><meta name="robots" content="noindex,nofollow" /></Head>
    <main className={styles.page}>
      <header className={styles.header}><div><span className={styles.eyebrow}>TEN KINGS · MARKET RESEARCH</span><h1>eBay Sold Comps</h1><p>Review real sold listings, choose the evidence, then confirm the value.</p></div><Link href={returnPath}>{returnPath === "/admin/ai-grader-v2/completed" ? "Completed cards" : "Back to card"}</Link></header>
      <section className={styles.panel} aria-label="Choose card or research mode">
        <div className={styles.lookup}><input className={styles.input} value={lookup} onChange={(e) => setLookup(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void findCards(); }} placeholder="Token, certificate, player, card name, or card number" aria-label="Find a permanent card" /><button className={styles.button} disabled={busy} onClick={() => void findCards()}>Find Card</button></div>
        <button className={styles.modeButton} type="button" onClick={() => { setMode("RESEARCH"); setCard(null); setCandidates([]); setSelected([]); setQuery(""); setReviewProof(null); setVisibleCount(COMPS_V2_INITIAL_VISIBLE_COUNT); setMessage("Research mode never saves to a card."); void router.replace({ pathname: "/admin/comps", query: returnPath !== "/admin/ai-grader-v2/completed" ? { from: returnPath } : {} }, undefined, { shallow: true }); }}>Search without a card</button>
        {matches.length ? <div className={styles.searchResults}>{matches.map((match) => <button className={styles.searchResult} key={match.id} onClick={() => chooseCard(match.id)}><span>{match.name ?? "Permanent card"}<small>{match.certificateNumber ?? "No certificate"} · {match.details}</small></span><span>Choose →</span></button>)}</div> : null}
      </section>

      {card ? <section className={styles.panel}><div className={styles.cardHero}>{card.imageUrl ? <img src={card.imageUrl} alt="Graded card" /> : <div className={styles.cardImagePlaceholder}>CARD</div>}<div><span className={styles.eyebrow}>{card.certificateNumber ?? card.publicToken}</span><h2>{card.category === "SPORTS" ? card.playerName : card.cardName}</h2><p>{[card.year, card.manufacturer, card.productSet, card.parallel, card.cardNumber].filter(Boolean).join(" · ")}</p>{card.targetGrade != null && card.psaTargetGrade != null ? <p>TK {card.targetGrade} — comping against PSA {card.psaTargetGrade}</p> : null}</div></div></section> : null}
      {mode === "RESEARCH" ? <section className={styles.panel}><span className={styles.eyebrow}>ZERO-WRITE RESEARCH</span><div className={styles.researchGrid}>
        <label>Category<select className={styles.select} value={research.category} onChange={(e) => setResearch({ ...research, category: e.target.value })}><option value="SPORTS">Sports</option><option value="POKEMON">Pokémon</option></select></label>
        {(["name", "year", "manufacturer", "productSet", "parallel", "cardNumber", "targetGrade"] as const).map((field) => <label key={field}>{field === "name" ? research.category === "SPORTS" ? "Player name" : "Card name" : ({ year: "Year", manufacturer: "Manufacturer", productSet: "Product / Set", parallel: "Parallel / Variant", cardNumber: "Card number", targetGrade: "Target grade" } as const)[field]}<input className={styles.input} value={research[field]} onChange={(e) => setResearch({ ...research, [field]: e.target.value })} /></label>)}
      </div></section> : null}

      {(card || mode === "RESEARCH") ? <section className={styles.panel}><div className={styles.queryRow}><label>Exact eBay sold search query<input className={styles.input} value={query} readOnly={isCompsV2QueryReadOnly(mode)} onChange={(e) => setQuery(e.target.value)} /></label><div className={styles.queryActions}><button className={styles.button} disabled={busy} onClick={() => void runSearch(candidates.length ? "REFRESH" : "FIND")}>{candidates.length ? "Refresh" : "Find Comps"}</button></div></div><p className={styles.status} role="status" aria-live="polite">{message}</p></section> : <p className={styles.status} role="status">{message}</p>}

      {candidates.length ? <div className={styles.layout}><section aria-label="Sold comp candidates">{GROUPS.map(([group, label]) => { const rows = visibleCompsV2Candidates(candidates, visibleCount).filter((candidate) => candidate.group === group); return rows.length ? <div className={styles.group} key={group}><h2>{label}</h2><div className={styles.rows}>{rows.map((candidate) => <article className={styles.row} key={candidate.id}><label className={styles.check}><span className="sr-only">Include {candidate.title}</span><input type="checkbox" disabled={!candidate.soldPriceCents} checked={selected.includes(candidate.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, candidate.id] : selected.filter((id) => id !== candidate.id))} /></label>{candidate.imageUrl ? <img src={candidate.imageUrl} alt="" /> : <div className={styles.noImage}>No image</div>}<div><h3>{candidate.title}</h3><div className={styles.meta}><span>{candidate.grader ? `${candidate.grader}${candidate.numericGrade ? ` ${candidate.numericGrade}` : ""}` : "Raw"}</span><span>{candidate.soldDate ?? "Sold date unavailable"}</span></div><p className={styles.reason}><b>{candidate.matchScore}/100</b> · {candidate.matchReason}</p></div><div className={styles.price}>{money(candidate.soldPriceCents)}<a href={candidate.listingUrl} target="_blank" rel="noopener noreferrer">View sold listing ↗</a></div></article>)}</div></div> : null; })}{visibleCount < candidates.length ? <div className={styles.more}><button className={styles.button} type="button" onClick={() => handleFetch30MoreCompsV2Click({ currentVisibleCount: visibleCount, candidateCount: candidates.length, selectedIds: selected, compsPublic, setVisibleCount })}>Fetch 30 More</button></div> : null}</section>
        <aside className={styles.rail} aria-label="Market value review"><span className={styles.eyebrow}>REVIEW</span><h2>{selected.length} selected</h2><div className={styles.math}>{priced.length ? `${priced.map(({ soldPriceCents }) => money(soldPriceCents)).join(" + ")} ÷ ${priced.length}` : "Select priced sold comps"}<strong>{money(average)}</strong>{priced.length ? <><small>Range {money(Math.min(...priced.map((row) => row.soldPriceCents!)))}–{money(Math.max(...priced.map((row) => row.soldPriceCents!)))}</small><small>Selected average becomes market value when confirmed</small></> : null}</div>{mode === "CARD" ? <><label className={styles.publicCheck}><input type="checkbox" checked={compsPublic} onChange={(e) => setCompsPublic(e.target.checked)} /><span>Show selected comps on the public card page</span></label><button className={styles.button} disabled={busy || !average} onClick={() => void confirmValue()}>Confirm Market Value</button>{!reviewProof && card?.snapshot?.selection.includedCount ? <button className={styles.modeButton} disabled={busy} onClick={() => void savePublic()}>Save Public Setting</button> : null}</> : <p className={styles.status}>Research mode does not save.</p>}</aside>
      </div> : (card || mode === "RESEARCH") ? <div className={styles.empty}>Sold results will appear here after you search.</div> : null}
    </main>
  </AppShell>;
}
