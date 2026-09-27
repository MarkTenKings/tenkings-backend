import { useEffect } from 'react';
// Direct requests use the static homepage rewrite. A Next client transition from
// another public page must start a fresh document for its scoped animation lifecycle.
export default function Home() {
    useEffect(() => { window.location.replace('/' + window.location.search + window.location.hash); }, []);
    return <main><button type="button" onClick={() => window.location.assign('/')}>Open ATLAS Grading</button></main>;
}
