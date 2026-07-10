import type { GetServerSideProps, InferGetServerSidePropsType } from "next";
import Head from "next/head";
import CinematicReportView from "../../../../components/ai-grader/cinematic/CinematicReport";
import { resolveAiGraderCinematicReportPageProps, type AiGraderCinematicReportPageProps } from "../../../../lib/server/aiGraderCinematicReportRoute";

export const getServerSideProps: GetServerSideProps<AiGraderCinematicReportPageProps> = async (context) => {
  const props = await resolveAiGraderCinematicReportPageProps(context.params?.reportId);
  return props ? { props } : { notFound: true };
};

export default function AiGraderCinematicReportPage({ report, fixture }: InferGetServerSidePropsType<typeof getServerSideProps>) {
  return (
    <>
      <Head>
        <title>{report.title ? `${report.title} · Ten Kings AI Grader` : "Ten Kings AI Grader Report"}</title>
        <meta name="robots" content="noindex" />
        <meta name="color-scheme" content="dark" />
      </Head>
      <CinematicReportView report={report} fixture={fixture} />
    </>
  );
}
