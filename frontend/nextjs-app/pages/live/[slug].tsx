import Head from "next/head";
import Link from "next/link";
import { GetServerSideProps } from "next";
import AppShell from "../../components/AppShell";
import { Prisma } from "@prisma/client";
import { prisma } from "@tenkings/database";

const embedForMedia = (videoUrl: string) => {
  if (/youtu\.be|youtube\.com/.test(videoUrl)) {
    try {
      const url = new URL(videoUrl);
      const videoId = url.searchParams.get("v") ?? videoUrl.split("/").pop();
      if (videoId) {
        return { type: "youtube" as const, id: videoId };
      }
    } catch (error) {
      // fall back to link
    }
  }
  if (videoUrl.endsWith(".mp4")) {
    return { type: "video" as const, src: videoUrl };
  }
  return { type: "link" as const, href: videoUrl };
};

interface LiveRipPageProps {
  liveRip: {
    id: string;
    slug: string;
    title: string;
    description: string | null;
    videoUrl: string;
    location: {
      id: string;
      name: string;
      slug: string;
    } | null;
    createdAt: string;
  };
  more: Array<{ slug: string; title: string }>;
}

export default function LiveRipPage({ liveRip, more }: LiveRipPageProps) {
  const media = embedForMedia(liveRip.videoUrl);

  const renderMedia = () => {
    switch (media.type) {
      case "youtube":
        return (
          <div className="relative w-full overflow-hidden rounded-[2.5rem] border border-white/10 bg-night-900/70 pt-[56.25%] shadow-card">
            <iframe
              className="absolute inset-0 h-full w-full"
              src={`https://www.youtube.com/embed/${media.id}`}
              title={liveRip.title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        );
      case "video":
        return (
          <video
            controls
            className="w-full rounded-[2.5rem] border border-white/10 bg-night-900/70 shadow-card"
          >
            <source src={media.src} type="video/mp4" />
            Your browser does not support embedded video.
          </video>
        );
      default:
        return (
          <div className="rounded-[2.5rem] border border-white/10 bg-night-900/70 p-10 text-center shadow-card">
            <p className="text-sm text-slate-300">
              This video is hosted externally. Follow the link below to watch the rip.
            </p>
            <Link
              href={media.href}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex items-center justify-center rounded-full border border-gold-500/60 bg-gold-500 px-6 py-3 text-xs uppercase tracking-[0.32em] text-night-900 shadow-glow transition hover:bg-gold-400"
            >
              Watch video
            </Link>
          </div>
        );
    }
  };

  return (
    <AppShell>
      <Head>
        <title>Ten Kings Live · {liveRip.title}</title>
        <meta
          name="description"
          content={`Watch ${liveRip.title} from the Ten Kings live rip series.`}
        />
      </Head>

      <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-12">
        <header className="space-y-3">
          <p className="text-xs uppercase tracking-[0.3em] text-violet-300">
            {liveRip.location?.name ?? "Ten Kings Live"}
          </p>
          <h1 className="font-heading text-4xl uppercase tracking-[0.2em] text-white md:text-5xl">
            {liveRip.title}
          </h1>
          <p className="text-xs text-slate-400">Recorded {new Date(liveRip.createdAt).toLocaleString()}</p>
        </header>

        {renderMedia()}

        {liveRip.description && (
          <div className="rounded-3xl border border-white/10 bg-night-900/70 p-6 text-sm text-slate-200">
            {liveRip.description}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={async () => {
              if (typeof window === "undefined") {
                return;
              }
              try {
                await navigator.clipboard.writeText(window.location.href);
              } catch (error) {
                // noop
              }
            }}
            className="rounded-full border border-white/20 px-6 py-2 text-xs uppercase tracking-[0.3em] text-slate-200 transition hover:border-gold-300 hover:text-gold-200"
          >
            Copy link
          </button>
          <Link
            href="/live"
            className="rounded-full border border-white/20 px-6 py-2 text-xs uppercase tracking-[0.3em] text-slate-200 transition hover:border-gold-300 hover:text-gold-200"
          >
            Back to live rips
          </Link>
          {liveRip.location && (
            <Link
              href={`/locations#${liveRip.location.slug}`}
              className="rounded-full border border-white/20 px-6 py-2 text-xs uppercase tracking-[0.3em] text-slate-200 transition hover:border-gold-300 hover:text-gold-200"
            >
              Visit location page
            </Link>
          )}
        </div>

        {more.length > 0 && (
          <section className="space-y-4">
            <h2 className="font-heading text-2xl uppercase tracking-[0.2em] text-white">More live rips</h2>
            <div className="grid gap-3 md:grid-cols-2">
              {more.map((entry) => (
                <Link
                  key={entry.slug}
                  href={`/live/${entry.slug}`}
                  className="rounded-2xl border border-white/10 bg-night-900/70 px-4 py-3 text-sm text-slate-200 transition hover:border-gold-400/60 hover:text-gold-200"
                >
                  {entry.title}
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}

export const getServerSideProps: GetServerSideProps<LiveRipPageProps> = async (context) => {
  const slug = Array.isArray(context.params?.slug) ? context.params?.slug[0] : context.params?.slug;

  if (!slug) {
    return { notFound: true };
  }

  let liveRip;
  try {
    liveRip = await prisma.liveRip.findUnique({
      where: { slug },
      include: {
        location: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021") {
      return {
        redirect: {
          destination: "/live",
          permanent: false,
        },
      };
    }
    throw error;
  }

  if (!liveRip) {
    return { notFound: true };
  }

  let more: Array<{ slug: string; title: string }>;
  try {
    more = await prisma.liveRip.findMany({
      where: {
        slug: { not: slug },
      },
      select: {
        slug: true,
        title: true,
      },
      orderBy: { createdAt: "desc" },
      take: 6,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021") {
      more = [];
    } else {
      throw error;
    }
  }

  return {
    props: {
      liveRip: {
        id: liveRip.id,
        slug: liveRip.slug,
        title: liveRip.title,
        description: liveRip.description,
        videoUrl: liveRip.videoUrl,
        location: liveRip.location,
        createdAt: liveRip.createdAt.toISOString(),
      },
      more: more.map((entry) => ({ slug: entry.slug, title: entry.title })),
    },
  };
};
