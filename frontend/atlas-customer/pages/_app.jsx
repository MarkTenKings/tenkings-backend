import '../styles/customer.css';
export default function App({ Component, pageProps, router }) {
    // All account pages share one component. A new route must create fresh
    // request/state ownership instead of carrying a previous card's detail.
    return <Component key={router.asPath} {...pageProps}/>;
}
