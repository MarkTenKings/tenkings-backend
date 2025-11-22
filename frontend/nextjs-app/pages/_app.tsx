import "../styles/globals.css";

import type { AppProps } from "next/app";
import Head from "next/head";
import { useRouter } from "next/router";
import { SessionProvider } from "../hooks/useSession";
import { Elements } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { bodyFont, displayFont, lightningFont } from "../components/fonts";

const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
const stripePromise = publishableKey ? loadStripe(publishableKey) : null;

export default function App({ Component, pageProps }: AppProps) {
  const router = useRouter();
  const componentRequiresStripe = Boolean((Component as typeof Component & { requiresStripe?: boolean }).requiresStripe);
  const routeRequiresStripe = router.pathname.startsWith("/packs");
  const shouldLoadStripe = componentRequiresStripe || routeRequiresStripe;

  const content = (
    <SessionProvider>
      <Component {...pageProps} />
    </SessionProvider>
  );

  const wrappedContent = shouldLoadStripe && stripePromise ? <Elements stripe={stripePromise}>{content}</Elements> : content;

  return (
    <div className={`${bodyFont.variable} ${displayFont.variable} ${lightningFont.variable}`}>
      <Head>
        <link rel="preconnect" href="https://stream.mux.com" />
        <link rel="dns-prefetch" href="https://stream.mux.com" />
      </Head>
      {wrappedContent}
    </div>
  );
}
