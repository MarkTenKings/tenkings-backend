export default function WorkspaceIcon({ name, className = '' }) {
    const paths = {
        PHOTOS: <><path d="M4 6h4l2-2h4l2 2h4v14H4z" /><circle cx="12" cy="12.5" r="4" /></>,
        IDENTITY: <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="8" cy="10" r="2" /><path d="M5 16c0-3 6-3 6 0m3-7h4m-4 4h4m-4 3h2" /></>,
        PREPARATION: <><path d="M7 3v14h14M3 7h14v14M11 3v4m6 6h4M3 11h4m6 6v4" /></>,
        CENTERING: <><rect x="5" y="5" width="14" height="14" rx="1" /><path d="M12 2v6m0 8v6M2 12h6m8 0h6" /></>,
        INSPECTION: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5M8 10.5h5m-2.5-2.5v5" /></>,
        REPORT: <><path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6m-6 4h6" /></>,
        REVIEW: <><path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6zM8 12l3 3 5-6" /></>,
        FINISHING: <><path d="m4 8 4-5h8l4 5-8 13zM4 8h16M8 3l4 18 4-18" /></>,
        PLAY: <path d="m8 5 11 7-11 7z" />,
        PAUSE: <><path d="M8 5v14M16 5v14" /></>,
        STEP: <><path d="m5 5 10 7L5 19zM19 5v14" /></>,
        TAKE_OVER: <><circle cx="12" cy="7" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>,
        CHECK: <path d="m5 12 4 4L19 6" />,
        CLOCK: <><circle cx="12" cy="12" r="9" /><path d="M12 6v6l4 2" /></>,
        REFRESH: <><path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5M4 16a8 8 0 0 0 14 3l3-3m0 5v-5h-5" /></>,
        ATTENTION: <><path d="m12 3 10 18H2zM12 9v5" /><path d="M12 17h.01" /></>,
        FEED: <><path d="M3 12h4l3-7 4 14 3-7h4" /></>,
    };
    return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name] ?? paths.REPORT}</svg>;
}
