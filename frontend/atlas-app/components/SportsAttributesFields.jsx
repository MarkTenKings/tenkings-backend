import React from 'react';
import { emptyAtlasSportsAttributes, atlasPrintedSerial, ATLAS_AUTOGRAPH_TYPES, ATLAS_RELIC_USE, ATLAS_SPORTS_ATTRIBUTE_LABELS as names } from '@atlas/grading-core/identity';
import styles from './ReviewIdentityPanel.module.css';

function Observations({ value, onChange, photos, label }) {
  return <div className={styles.observations}>{['FRONT', 'BACK'].map(side => <label key={side}>
    <span>{label} · {side === 'FRONT' ? 'Front' : 'Back'} evidence</span>
    <input aria-label={`${label} ${side.toLowerCase()} evidence`} maxLength={600} disabled={!photos?.[side]}
      placeholder="Visible text or location; leave unknown if unclear" value={value.find(item => item.side === side)?.observation ?? ''}
      onChange={event => onChange([...value.filter(item => item.side !== side), ...(event.target.value.trim() ? [{ side, imageSha256: photos[side], observation: event.target.value }] : [])])}/>
  </label>)}</div>;
}
function Presence({ label, value, onChange }) {
  return <label><span>{label}</span><select aria-label={label} value={value} onChange={event => onChange(event.target.value)}>
    <option value="UNKNOWN">Unknown / not detected</option><option value="PRESENT">Present — reviewed</option><option value="ABSENT">Absent — both sides reviewed</option>
  </select></label>;
}

export function SportsAttributesSummary({ value }) {
  if (!value) return <p className={styles.attributeNote}>Numbering, autograph and relic details have not been reviewed.</p>;
  return <dl className={styles.summary}>
    <div><dt>Printed serial</dt><dd>{value.serial.presence === 'PRESENT' ? value.serial.printed : names[value.serial.presence]}</dd></div>
    <div><dt>Autograph</dt><dd>{names[value.autograph.presence]}{value.autograph.presence === 'PRESENT' ? ` · ${names[value.autograph.type]}` : ''}</dd></div>
    <div><dt>Relic</dt><dd>{names[value.relic.presence]}</dd></div>
    {value.relic.windows.map((window, index) => <div key={index}><dt>{window.position}</dt><dd>{window.material || 'Material unknown'} · {names[window.use]}{window.manufacturerStatement && <q className={styles.statement}>{window.manufacturerStatement}</q>}</dd></div>)}
  </dl>;
}

/** Editing only creates an ordinary draft. The existing Save details action
 * binds the observations to the saved photographs and authenticated reviewer. */
export default function SportsAttributesFields({ value, onChange, photos, errors = {} }) {
  if (!value) return <div className={styles.attributes}><button type="button" onClick={() => onChange(emptyAtlasSportsAttributes())}>Review numbered, autograph and relic details</button><p className={styles.attributeNote}>Not detected stays unknown. Presence does not establish autograph authentication.</p></div>;
  const update = (key, patch) => onChange({ ...value, [key]: { ...value[key], ...patch } });
  const updateWindow = (index, patch) => update('relic', { windows: value.relic.windows.map((window, current) => current === index ? { ...window, ...patch } : window) });
  const errorMessages = Object.entries(errors).filter(([key]) => key.startsWith('sportsAttributes')).map(([, message]) => message);
  return <div className={styles.attributes}>
    <h3>Numbered edition, autograph and relic</h3><p className={styles.attributeNote}>Review both photographs. Keep the checklist card number separate. Presence does not establish autograph authentication; a relic’s material does not establish use or wear.</p>
    <div className={styles.attributeGroup}>
      <Presence label="Serial numbering" value={value.serial.presence} onChange={presence => update('serial', { presence, ...(presence !== 'PRESENT' ? { printed: null, numerator: null, denominator: null } : {}) })}/>
      {value.serial.presence === 'PRESENT' && <label><span>Serial exactly as printed</span><input aria-label="Serial exactly as printed" value={value.serial.printed ?? ''} maxLength={30} placeholder="007/099" onChange={event => {
        const printed = event.target.value; let numeric = { numerator: null, denominator: null }; try { numeric = atlasPrintedSerial(printed); } catch { /* Incomplete typing remains a draft. */ }
        update('serial', { ...numeric, printed });
      }}/><small>Copy {value.serial.numerator ?? '?'} of {value.serial.denominator ?? '?'} · comparable search {value.serial.denominator ? `/${value.serial.denominator}` : 'unknown'}</small></label>}
      <Observations label="Serial" value={value.serial.evidence} photos={photos} onChange={evidence => update('serial', { evidence })}/>
    </div>
    <div className={styles.attributeGroup}>
      <Presence label="Autograph presence" value={value.autograph.presence} onChange={presence => update('autograph', { presence, ...(presence !== 'PRESENT' ? { type: 'UNKNOWN' } : {}) })}/>
      {value.autograph.presence === 'PRESENT' && <label><span>Autograph type</span><select aria-label="Autograph type" value={value.autograph.type} onChange={event => update('autograph', { type: event.target.value })}>{ATLAS_AUTOGRAPH_TYPES.map(type => <option key={type} value={type}>{names[type]}</option>)}</select></label>}
      <Observations label="Autograph" value={value.autograph.evidence} photos={photos} onChange={evidence => update('autograph', { evidence })}/>
    </div>
    <div className={styles.attributeGroup}>
      <Presence label="Relic presence" value={value.relic.presence} onChange={presence => update('relic', { presence, ...(presence !== 'PRESENT' ? { windows: [] } : {}) })}/>
      <Observations label="Relic" value={value.relic.evidence} photos={photos} onChange={evidence => update('relic', { evidence })}/>
      {value.relic.presence === 'PRESENT' && <>
        {value.relic.windows.map((window, index) => <div className={styles.relicWindow} key={index}>
          <h4>Relic window {index + 1}</h4>
          <label><span>Window position</span><input aria-label={`Relic ${index + 1} position`} maxLength={80} value={window.position} onChange={event => updateWindow(index, { position: event.target.value })}/></label>
          <label><span>Material</span><input aria-label={`Relic ${index + 1} material`} maxLength={120} placeholder="Unknown" value={window.material ?? ''} onChange={event => updateWindow(index, { material: event.target.value || null })}/></label>
          <label className={styles.wideAttribute}><span>Exact manufacturer statement</span><input aria-label={`Relic ${index + 1} manufacturer statement`} maxLength={600} placeholder="Quote the printed use or wear statement; otherwise leave unknown" value={window.manufacturerStatement ?? ''} onChange={event => updateWindow(index, { manufacturerStatement: event.target.value || null })}/></label>
          <label className={styles.wideAttribute}><span>Manufacturer use / wear</span><select aria-label={`Relic ${index + 1} use or wear`} value={window.use} onChange={event => updateWindow(index, { use: event.target.value })}>{ATLAS_RELIC_USE.map(use => <option key={use} value={use}>{names[use]}</option>)}</select></label>
          <Observations label={`Relic window ${index + 1}`} value={window.evidence} photos={photos} onChange={evidence => updateWindow(index, { evidence })}/>
          <button type="button" onClick={() => update('relic', { windows: value.relic.windows.filter((_, current) => current !== index) })}>Remove window {index + 1}</button>
        </div>)}
        <button type="button" disabled={value.relic.windows.length >= 12} onClick={() => update('relic', { windows: [...value.relic.windows, { position: `Window ${value.relic.windows.length + 1}`, material: null, manufacturerStatement: null, use: 'UNKNOWN', evidence: [] }] })}>Add relic window</button>
      </>}
    </div>
    {!photos?.FRONT || !photos?.BACK ? <p className={styles.attributeNote}>Saved photograph evidence is unavailable. Reopen the card before recording new claims.</p> : null}
    {[...new Set(errorMessages)].map(message => <p className={styles.error} role="alert" key={message}>{message}</p>)}
  </div>;
}
