import Head from 'next/head';
import MarketingHome from '../components/MarketingHome';
import { publicHeaders } from '../lib/server/policy.mjs';
export async function getServerSideProps(ctx) {
    publicHeaders(ctx.res);
    return { props: { customerFunnelEnabled: process.env.ATLAS_PUBLIC_CUSTOMER_FUNNEL_ENABLED === 'true' } };
}
export default function Home({ customerFunnelEnabled = false }) {
    return <><Head><title>ATLAS — The Rolex of Grading</title>
        <meta name="description" content="ATLAS maps, measures, and certifies the physical identity of trading cards. Explore the process and follow your cards from submission to return."/>
        <meta name="theme-color" content="#080807"/><meta name="robots" content="noindex,nofollow"/>
    </Head><MarketingHome customerFunnelEnabled={customerFunnelEnabled}/></>;
}
