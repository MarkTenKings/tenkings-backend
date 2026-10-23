import React from 'react';
import { emptyAtlasSportsAttributes, atlasPrintedSerial, ATLAS_AUTOGRAPH_TYPES, ATLAS_RELIC_USE, ATLAS_SPORTS_SPECIAL_FEATURE_KINDS, ATLAS_SPORTS_ATTRIBUTE_LABELS as names } from '@atlas/grading-core/identity';
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
  if (!value) return <p className={styles.attributeNote}>Special features, numbering, autograph and relic details have not been reviewed.</p>;
  return <dl className={styles.summary}>
    <div><dt>Printed serial</dt><dd>{value.serial.presence === 'PRESENT' ? value.serial.printed : names[value.serial.presence]}</dd></div>
    <div><dt>Autograph</dt><dd>{names[value.autograph.presence]}{value.autograph.presence === 'PRESENT' ? ` · ${names[value.autograph.type]}` : ''}</dd></div>
    <div><dt>Relic</dt><dd>{names[value.relic.presence]}</dd></div>
    {value.specialFeatures?.map(feature => <div key={feature.kind}><dt>Confirmed special feature</dt><dd>{names[feature.kind]}{feature.evidence && <small className={styles.statement}>{feature.evidence.sourceTitle} · {feature.evidence.matchNote}</small>}</dd></div>)}
    {value.relic.windows.map((window, index) => <div key={index}><dt>{window.position}</dt><dd>{window.material || 'Material unknown'} · {names[window.use]}{window.manufacturerStatement && <q className={styles.statement}>{window.manufacturerStatement}</q>}</dd></div>)}
  </dl>;
}

/** Editing only creates an ordinary draft. The existing Save details action
 * binds the observations to the saved photographs and authenticated reviewer. */
export default function SportsAttributesFields({ value, onChange, photos, errors = {} }) {
  if (!value) return <div className={styles.attributes}><button type="button" onClick={() => onChange(emptyAtlasSportsAttributes())}>Review special features, numbering, autograph and relic details</button><p className={styles.attributeNote}>Unconfirmed details stay unknown. Presence does not establish autograph authentication.</p></div>;
  const update = (key, patch) => onChange({ ...value, [key]: { ...value[key], ...patch } });
  const updateWindow = (index, patch) => update('relic', { windows: value.relic.windows.map((window, current) => current === index ? { ...window, ...patch } : window) });
  const features = value.specialFeatures ?? [];
  const setFeatures = next => {
    const { specialFeatures: _prior, ...attributes } = value;
    onChange(next.length ? { ...attributes, specialFeatures: next } : attributes);
  };
  const updateFeature = (index, patch) => setFeatures(features.map((feature, current) => current === index ? { ...feature, ...patch } : feature));
  const errorMessages = Object.entries(errors).filter(([key]) => key.startsWith('sportsAttributes')).map(([, message]) => message);
  return <div className={styles.attributes}>
    <h3>Confirmed special features</h3><p className={styles.attributeNote}>Use a reviewed reference that identifies this exact card and printing. A set or insert name alone does not confirm a case hit or short print.</p>
    {features.map((feature, index) => <div className={styles.attributeGroup} key={index}>
      <label><span>Special feature</span><select aria-label={`Special feature ${index + 1}`} value={feature.kind} onChange={event => updateFeature(index, { kind: event.target.value })}>{ATLAS_SPORTS_SPECIAL_FEATURE_KINDS.map(kind => <option key={kind} value={kind} disabled={features.some((other, current) => current !== index && other.kind === kind)}>{names[kind]}</option>)}</select></label>
      <label><span>Reference title</span><input aria-label={`Special feature ${index + 1} reference title`} value={feature.evidence.sourceTitle} maxLength={160} placeholder="Manufacturer checklist or other reviewed reference" onChange={event => updateFeature(index, { evidence: { ...feature.evidence, sourceTitle: event.target.value } })}/></label>
      <label className={styles.wideAttribute}><span>Reference URL</span><input type="url" aria-label={`Special feature ${index + 1} reference URL`} value={feature.evidence.sourceUrl} maxLength={2048} placeholder="https://…" onChange={event => updateFeature(index, { evidence: { ...feature.evidence, sourceUrl: event.target.value } })}/></label>
      <label className={styles.wideAttribute}><span>Exact card and printing match</span><input aria-label={`Special feature ${index + 1} match note`} value={feature.evidence.matchNote} maxLength={600} placeholder="Record the matching card number, printing and supporting statement" onChange={event => updateFeature(index, { evidence: { ...feature.evidence, matchNote: event.target.value } })}/></label>
      <button type="button" onClick={() => setFeatures(features.filter((_, current) => current !== index))}>Remove special feature {index + 1}</button>
    </div>)}
    <button type="button" disabled={features.length >= ATLAS_SPORTS_SPECIAL_FEATURE_KINDS.length} onClick={() => setFeatures([...features, { kind: ATLAS_SPORTS_SPECIAL_FEATURE_KINDS.find(kind => !features.some(feature => feature.kind === kind)), evidence: { type: 'REVIEWED_REFERENCE', sourceTitle: '', sourceUrl: '', matchNote: '' } }])}>Add confirmed special feature</button>
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
