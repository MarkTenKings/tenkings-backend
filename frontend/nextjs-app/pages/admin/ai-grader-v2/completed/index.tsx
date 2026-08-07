import Head from "next/head";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import AppShell from "../../../../components/AppShell";
import { hasAdminAccess, hasAdminPhoneAccess } from "../../../../constants/admin";
import { useSession } from "../../../../hooks/useSession";
import { buildAdminHeaders } from "../../../../lib/adminHeaders";
import styles from "../../../../styles/AiGraderV2PostGrade.module.css";

type CompletedCard = {
  id: string;
  cardProfile: string;
  title: string;
  details: string[];
  grade: number | null;
  certificateNumber: string | null;
  slabPhotosDone: boolean;
  permanentCard: {
    id: string;
    publicToken: string;
    lifecycleState: string;
    nfcVerifiedAt: string | null;
  } | null;
  createdAt: string;
};

export default function CompletedSpeedsterCardsPage() {
  const { session, loading, ensureSession } = useSession();
  const [cards, setCards] = useState<CompletedCard[]>([]);
  const [message, setMessage] = useState("Loading completed cards.");
  const isAdmin = useMemo(
    () => hasAdminAccess(session?.user.id) || hasAdminPhoneAccess(session?.user.phone),
    [session?.user.id, session?.user.phone],
  );

  useEffect(() => {
    if (!session?.token || !isAdmin) return;
    let active = true;
    void fetch("/api/admin/ai-grader-v2/completed", { headers: buildAdminHeaders(session.token) })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({})) as { cards?: CompletedCard[]; message?: string };
        if (!response.ok || !payload.cards) throw new Error(payload.message ?? "Completed cards could not be loaded.");
        if (active) {
          setCards(payload.cards);
          setMessage(payload.cards.length ? `${payload.cards.length} completed card${payload.cards.length === 1 ? "" : "s"}.` : "No completed Speedster cards yet.");
        }
      })
      .catch((error) => { if (active) setMessage(error instanceof Error ? error.message : "Completed cards could not be loaded."); });
    return () => { active = false; };
  }, [isAdmin, session?.token]);

  if (loading) return <AppShell background="black"><div className={styles.center}>Loading Speedster…</div></AppShell>;
  if (!session) return <AppShell background="black"><div className={styles.center}><button onClick={() => void ensureSession()}>Sign in to Speedster</button></div></AppShell>;
  if (!isAdmin) return <AppShell background="black"><div className={styles.center}>Admin access required.</div></AppShell>;

  return (
    <AppShell background="black" hideFooter>
      <Head><title>Completed Cards | Speedster</title><meta name="robots" content="noindex,nofollow" /></Head>
      <main className={styles.page}>
        <header className={styles.hero}>
          <div><span>TEN KINGS · POST GRADING</span><h1>Completed cards.</h1><p>{message}</p></div>
          <nav><Link href="/admin/ai-grader-v2">New card</Link><Link href="/admin/human-grade">Label pages</Link></nav>
        </header>
        <section className={styles.cardList} aria-label="Completed Speedster cards">
          {cards.map((card) => (
            <Link className={styles.cardRow} href={`/admin/ai-grader-v2/completed/${card.id}`} key={card.id}>
              <div className={styles.cardGrade}>{card.grade?.toFixed(1) ?? "—"}</div>
              <div className={styles.cardIdentity}>
                <small>{card.cardProfile} · {card.certificateNumber ?? "LABEL READY"}</small>
                <strong>{card.title}</strong>
                <span>{card.details.join(" · ")}</span>
              </div>
              <div className={styles.cardProgress}>
                <strong>{card.permanentCard?.lifecycleState ?? "V2 PENDING"}</strong>
                {card.permanentCard?.nfcVerifiedAt ? <span>NFC VERIFIED</span> : null}
              </div>
              <time>{new Date(card.createdAt).toLocaleDateString()}</time>
              <b>→</b>
            </Link>
          ))}
        </section>
      </main>
    </AppShell>
  );
}
