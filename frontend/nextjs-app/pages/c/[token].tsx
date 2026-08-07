import type { GetServerSideProps } from "next";

import SpeedsterPublicReport, {
  createSpeedsterReportGetServerSideProps,
  type PublicReportProps,
} from "../ai-grader-v2/reports/[slug]";
import { projectPublicCompsV2 } from "../../lib/compsV2Public";

const PUBLIC_TOKEN = /^tk2c_[A-Za-z0-9_-]{32}$/;

type CardPageDependencies = {
  findCard: (publicToken: string) => Promise<{
    speedsterSessionId: string;
    publicReportSlug: string;
    lifecycleState: string;
    compsSnapshot?: unknown;
    compsPublic?: boolean;
  } | null>;
  findCompletedSession: (sessionId: string, publicReportSlug: string) => Promise<unknown | null>;
  presign: (storageKey: string) => Promise<string>;
};

export function createCollectibleCardV2GetServerSideProps(
  deps: CardPageDependencies,
): GetServerSideProps<PublicReportProps> {
  return async function collectibleCardV2GetServerSideProps(context) {
    context.res.setHeader("Cache-Control", "private, no-store");
    const publicToken = typeof context.params?.token === "string" && PUBLIC_TOKEN.test(context.params.token)
      ? context.params.token
      : null;
    if (!publicToken) return { notFound: true };

    const card = await deps.findCard(publicToken);
    if (!card || card.lifecycleState === "VOID") return { notFound: true };

    const reportHandler = createSpeedsterReportGetServerSideProps({
      findCompletedSession: async (slug) => {
        if (slug !== card.publicReportSlug) return null;
        return deps.findCompletedSession(card.speedsterSessionId, card.publicReportSlug);
      },
      presign: deps.presign,
    });

    const result = await reportHandler({
      ...context,
      params: { ...context.params, slug: card.publicReportSlug },
    });
    if (!("props" in result) || !card.compsPublic) return result;
    const resolvedProps = await result.props;
    const publicComps = projectPublicCompsV2({
      compsPublic: true,
      compsSnapshot: (card.compsSnapshot ?? null) as never,
    });
    return { props: { ...resolvedProps, publicComps } };
  };
}

export const getServerSideProps: GetServerSideProps<PublicReportProps> = async (context) => {
  const [{ prisma }, { presignReadUrl }] = await Promise.all([
    import("@tenkings/database"),
    import("../../lib/server/storage"),
  ]);
  return createCollectibleCardV2GetServerSideProps({
    findCard: (publicToken) => prisma.collectibleCardV2.findUnique({
      where: { publicToken },
      select: {
        speedsterSessionId: true,
        publicReportSlug: true,
        lifecycleState: true,
        compsSnapshot: true,
        compsPublic: true,
      },
    }),
    findCompletedSession: (sessionId, publicReportSlug) => prisma.aiGraderV2Session.findFirst({
      where: {
        id: sessionId,
        publicReportSlug,
        workflowState: "COMPLETED",
      },
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

export default SpeedsterPublicReport;
