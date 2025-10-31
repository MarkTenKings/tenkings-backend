import "../styles/globals.css";

import type { AppProps } from "next/app";
import Head from "next/head";
import { SessionProvider } from "../hooks/useSession";
import { Elements } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { bodyFont, displayFont, lightningFont } from "../components/fonts";

const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
const stripePromise = publishableKey ? loadStripe(publishableKey) : null;

export default function App({ Component, pageProps }: AppProps) {
  const content = (
    <SessionProvider>
      <Component {...pageProps} />
    </SessionProvider>
  );

  if (!stripePromise) {
    return (
      <div className={`${bodyFont.variable} ${displayFont.variable} ${lightningFont.variable}`}>
        <Head>
          <link rel="preconnect" href="https://stream.mux.com" />
          <link rel="dns-prefetch" href="https://stream.mux.com" />
        </Head>
        {content}
      </div>
    );
  }

  return (
    <div className={`${bodyFont.variable} ${displayFont.variable} ${lightningFont.variable}`}>
      <Head>
        <link rel="preconnect" href="https://stream.mux.com" />
        <link rel="dns-prefetch" href="https://stream.mux.com" />
      </Head>
      <Elements stripe={stripePromise}>{content}</Elements>
    </div>
  );
}
