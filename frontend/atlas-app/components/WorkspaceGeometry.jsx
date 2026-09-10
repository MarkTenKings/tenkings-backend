import { useEffect, useRef, useState } from 'react';
import { Notice } from './Shell';
import styles from './WorkspaceUi.module.css';

const corners = ['Top left', 'Top right', 'Bottom right', 'Bottom left'];
const clamp = number => Math.min(1, Math.max(0, Math.round(number * 100000) / 100000));
export const fullCardFrame = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
export function ImageQuadEditor({ imageUrl, points = [], savedPoints = [], disabled, onChange, onReady, label = 'Card boundary', fixedOuter = false }) {
    const svg = useRef(null), drag = useRef(null), [loaded, setLoaded] = useState(false), [error, setError] = useState('');
    useEffect(() => { setLoaded(false); setError(''); onReady?.(false); }, [imageUrl, onReady]);
    const blocked = disabled || !loaded || Boolean(error);
    const position = event => { const box = svg.current.getBoundingClientRect(); return { x: clamp((event.clientX - box.left) / box.width), y: clamp((event.clientY - box.top) / box.height) }; };
    function begin(event) {
        if (blocked || event.button !== 0) return;
        event.preventDefault();
        const index = event.target.getAttribute('data-corner');
        if (index !== null) { drag.current = { index: Number(index), pointerId: event.pointerId }; svg.current.setPointerCapture(event.pointerId); }
        else if (points.length < 4) onChange([...points, position(event)]);
    }
    function move(event) {
        if (blocked || drag.current?.pointerId !== event.pointerId) return;
        onChange(points.map((point, index) => index === drag.current.index ? position(event) : point));
    }
    function key(event, index) {
        if (blocked || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault(); const step = event.shiftKey ? .01 : .001;
        onChange(points.map((point, current) => current === index ? { x: clamp(point.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0)), y: clamp(point.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0)) } : point));
    }
    const encoded = value => value.map(point => `${point.x * 1000},${point.y * 1000}`).join(' ');
    if (!imageUrl) return <div className={styles.geometryUnavailable}><h3>{fixedOuter ? 'Prepared image required' : 'Original photograph required'}</h3><p>{fixedOuter ? 'Centering uses the rectified card image produced by verified preparation.' : 'Upload and verify this side before marking its physical boundary.'}</p></div>;
    return <div className={styles.geometryEditor}><div className={styles.geometryImage}>
        <img src={imageUrl} alt={label} onLoad={() => { setLoaded(true); onReady?.(true); }} onError={() => { setError('This image could not be loaded. Reload the saved card before confirming the outline.'); onReady?.(false); }} />
        {loaded && <svg ref={svg} viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-label={`${label} editor`} onPointerDown={begin} onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
            {fixedOuter && <polygon points={encoded(fullCardFrame)} className={styles.outerFrame} />}
            {savedPoints.length === 4 && <polygon points={encoded(savedPoints)} className={styles.savedOutline} />}
            {points.length > 1 && (points.length === 4 ? <polygon points={encoded(points)} className={styles.activeOutline} /> : <polyline points={encoded(points)} className={styles.activeOutline} />)}
            {points.map((point, index) => <g key={index}><circle data-corner={index} cx={point.x * 1000} cy={point.y * 1000} r="13" role="button" tabIndex={blocked ? -1 : 0} aria-label={`${corners[index]} handle. Use arrow keys to adjust.`} onKeyDown={event => key(event, index)} /><text x={point.x * 1000} y={point.y * 1000 + 5} textAnchor="middle" aria-hidden="true">{index + 1}</text></g>)}
        </svg>}
    </div>{error && <Notice error>{error}</Notice>}<div className={styles.geometryInstructions}><p>{points.length < 4 ? `Select corner ${points.length + 1}: ${corners[points.length].toLowerCase()}. Continue clockwise.` : 'Drag a handle to refine the outline. Arrow keys move a focused handle; Shift moves it further.'}</p><button type="button" disabled={blocked || !points.length} onClick={() => onChange([])}>Clear edited outline</button></div></div>;
}
