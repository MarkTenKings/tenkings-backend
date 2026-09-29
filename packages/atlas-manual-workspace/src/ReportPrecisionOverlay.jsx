import React, { useState } from 'react';
import { measureSpeedsterCenteringBorders } from '@atlas/grading-core/scoring';
import { reportFindingBounds } from './report-review-ui.mjs';

const mm = value => Number.isFinite(value) ? value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 3 }) : 'Unavailable';
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/** Screen-space instruments; all endpoints remain bound to saved canonical geometry. */
export function ReportPrecisionOverlay({ finding, printed, project, size, mode, moving = false, onInteract }) {
  const [active, setActive] = useState(null);
  if (moving) return null;
  const labels = [], paths = [];
  if (mode === 'centering' && printed) {
    let borders; try { borders = measureSpeedsterCenteringBorders(printed); } catch { return null; }
    const midpoints = printed.map((p, index) => ({x:(p.x+printed[(index+1)%4].x)/2,y:(p.y+printed[(index+1)%4].y)/2}));
    const pairs = [
      ['Top', borders.topMm, {x:midpoints[0].x,y:0}, midpoints[0], 0, -30],
      ['Right', borders.rightMm, {x:1,y:midpoints[1].y}, midpoints[1], 42, 0],
      ['Bottom', borders.bottomMm, {x:midpoints[2].x,y:1}, midpoints[2], 0, 30],
      ['Left', borders.leftMm, {x:0,y:midpoints[3].y}, midpoints[3], -42, 0],
    ];
    for (const [name, value, start, end, dx, dy] of pairs) {
      const a = project(start), b = project(end), vertical = name === 'Top' || name === 'Bottom';
      paths.push(`M${a.x} ${a.y}L${b.x} ${b.y} M${a.x-(vertical?5:0)} ${a.y-(vertical?0:5)}l${vertical?10:0} ${vertical?0:10} M${b.x-(vertical?5:0)} ${b.y-(vertical?0:5)}l${vertical?10:0} ${vertical?0:10}`);
      labels.push({ name, value: `${mm(value)} mm`, x: clamp(a.x+dx, 39, size.width-39), y: clamp(a.y+dy, 27, size.height-27), anchor: a });
    }
  } else if (mode === 'finding' && finding) {
    const box = reportFindingBounds(finding); if (!box) return null;
    const a = project(box), b = project({x:box.x+box.width,y:box.y+box.height});
    const x = a.x-9, y = a.y-9, right = b.x+9, bottom = b.y+9, notch = 8;
    paths.push(`M${x+notch} ${y}H${x}V${y+notch} M${right-notch} ${y}H${right}V${y+notch} M${x} ${bottom-notch}V${bottom}H${x+notch} M${right-notch} ${bottom}H${right}V${bottom-notch}`);
    const rulerY = a.y-25, rulerX = b.x+25;
    paths.push(`M${a.x} ${rulerY-4}v8 M${a.x} ${rulerY}H${b.x} M${b.x} ${rulerY-4}v8 M${rulerX-4} ${a.y}h8 M${rulerX} ${a.y}V${b.y} M${rulerX-4} ${b.y}h8`);
    labels.push({name:'Marked width', value:`${mm(box.width*1270/20)} mm`,x:clamp((a.x+b.x)/2,66,size.width-66),y:clamp(rulerY-25,64,size.height-30)});
    labels.push({name:'Marked height',value:`${mm(box.height*1778/20)} mm`,x:clamp(rulerX+65,66,size.width-66),y:clamp((a.y+b.y)/2,124,size.height-35)});
  } else return null;
  return <div className={`rr-precision-overlay rr-precision-${mode}`} aria-label={mode === 'centering' ? 'Saved border measurements in millimeters' : 'Saved trace dimensions in millimeters'}>
    <svg width={size.width} height={size.height} aria-hidden="true">{paths.map((path,i)=><g key={i} className={labels[i]?.name === active ? 'rr-instrument-active' : undefined}><path className="rr-instrument-underlay" d={path}/><path d={path}/></g>)}{labels.filter(label=>label.anchor).map(label=><path className="rr-instrument-leader" key={label.name} d={`M${label.anchor.x} ${label.anchor.y}L${label.x} ${label.y}`}/>)}</svg>
    {labels.map(label => mode === 'centering' ? <button type="button" className="rr-instrument-label" key={label.name} style={{left:label.x,top:label.y}} aria-label={`${label.name} border ${label.value}`} aria-pressed={active === label.name}
      onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}
      onPointerEnter={() => setActive(label.name)} onFocus={() => setActive(label.name)} onClick={() => { onInteract?.(); setActive(label.name); }}><small>{label.name}</small><b>{label.value}</b></button>
      : <span className="rr-instrument-label" key={label.name} style={{left:label.x,top:label.y}}><small>{label.name}</small><b>{label.value}</b></span>)}
  </div>;
}
