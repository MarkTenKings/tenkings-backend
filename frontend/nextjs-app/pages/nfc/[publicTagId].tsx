import type { GetServerSideProps } from "next";
import Head from "next/head";
import Link from "next/link";
import {
  readAiGraderNfcPublicTap,
  type AiGraderNfcPublicTapData,
} from "../../lib/server/aiGraderNfcPublic";

type Props = { tap: AiGraderNfcPublicTapData };

export const getServerSideProps: GetServerSideProps<Props> = async (context) => {
  context.res.setHeader("Cache-Control", "no-store");
  const publicTagId = Array.isArray(context.params?.publicTagId)
    ? context.params?.publicTagId[0]
    : context.params?.publicTagId;
  const tap = await readAiGraderNfcPublicTap(typeof publicTagId === "string" ? publicTagId : "");
  if (tap.state === "unavailable") context.res.statusCode = 503;
  return {
    props: { tap },
  };
};

export default function AiGraderNfcTapPage({ tap }: Props) {
  const active = tap.state === "active" ? tap : null;
  const title = active
    ? active.chipType === "FEIJU_F8215"
      ? "Write-protected registered NFC link"
      : "Registered Ten Kings NFC link"
    : tap.state === "unavailable"
      ? "NFC link temporarily unavailable"
    : tap.state === "revoked"
      ? "NFC link revoked"
      : "NFC link not valid";
  return (
    <>
      <Head>
        <title>{title} | Ten Kings</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>
      <main className="shell">
        <section className="card">
          <p className="eyebrow">Ten Kings AI Grader</p>
          <h1>{title}</h1>
          {active ? (
            <>
              <p className="lead">Linked to this Ten Kings AI Grader report.</p>
              <dl>
                <div><dt>Card</dt><dd>{active.cardTitle}</dd></div>
                {active.cardSet ? <div><dt>Set</dt><dd>{active.cardSet}</dd></div> : null}
                {active.grade !== undefined ? <div><dt>AI Grader grade</dt><dd>{active.grade.toFixed(1)}</dd></div> : null}
                <div><dt>Report</dt><dd>{active.reportId}</dd></div>
                <div><dt>Certificate ID</dt><dd>{active.certId}</dd></div>
                <div><dt>NFC status</dt><dd>Registered link</dd></div>
              </dl>
              <p className="disclosure">
                This registered link is a convenience identity link. {active.chipType === "FEIJU_F8215" ? "Consumer write protection does not make its static URL unclonable. " : ""}It is not cryptographic authentication of the chip, slab, or card.
              </p>
              <Link className="action" href={active.reportUrl}>Open Ten Kings AI Grader report</Link>
            </>
          ) : (
            <p className="lead">
              {tap.state === "revoked"
                ? "This Ten Kings NFC link has been revoked and no longer resolves to a valid report registration."
                : tap.state === "unavailable"
                  ? "Ten Kings NFC registration lookup is temporarily unavailable. Please try again later."
                : "This NFC link is not an active Ten Kings report registration."}
            </p>
          )}
        </section>
      </main>
      <style jsx>{`
        .shell { min-height: 100vh; display: grid; place-items: center; padding: 24px; background: #f3f0e9; color: #171614; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
        .card { width: min(100%, 620px); padding: 32px; border: 1px solid rgba(20,20,20,.14); border-radius: 14px; background: rgba(255,255,255,.9); box-shadow: 0 24px 70px rgba(55,45,25,.12); }
        .eyebrow { margin: 0 0 10px; color: #8a6a27; font-size: 11px; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; }
        h1 { margin: 0; font-size: clamp(30px, 7vw, 46px); line-height: 1.02; }
        .lead, .disclosure { line-height: 1.55; }
        .lead { margin: 18px 0; font-size: 18px; }
        .disclosure { margin: 22px 0; padding: 14px; border-radius: 9px; background: #f7f1df; color: #5c523d; font-size: 14px; }
        dl { display: grid; gap: 1px; margin: 24px 0; overflow: hidden; border: 1px solid rgba(20,20,20,.1); border-radius: 9px; background: rgba(20,20,20,.1); }
        dl div { display: grid; grid-template-columns: 140px minmax(0,1fr); gap: 14px; padding: 12px 14px; background: #fff; }
        dt { color: #776f63; font-weight: 700; }
        dd { margin: 0; overflow-wrap: anywhere; }
        .action { display: inline-flex; min-height: 46px; align-items: center; justify-content: center; padding: 0 18px; border-radius: 8px; background: #171614; color: #fff; font-weight: 800; text-decoration: none; }
        @media (max-width: 520px) { .card { padding: 24px; } dl div { grid-template-columns: 1fr; gap: 4px; } }
      `}</style>
    </>
  );
}
