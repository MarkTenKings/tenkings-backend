import React, { useEffect, useRef } from 'react';
import { reviewIdentityChanged, reviewIdentityFields } from '../lib/review-identity.mjs';
import styles from './ReviewIdentityPanel.module.css';

const kindNames = { POKEMON: 'Pokémon', TRAINER: 'Trainer', ENERGY: 'Energy' };

export default function ReviewIdentityPanel({ identity, draft, errors = {}, disabled = false, saving = false,
  readOnly = false, onEdit, onChange, onCancel, onSave }) {
  const firstInput = useRef(null), editButton = useRef(null), wasEditing = useRef(false);
  const editing = Boolean(draft), fields = reviewIdentityFields(identity);
  useEffect(() => {
    if (editing) firstInput.current?.focus({ preventScroll: true });
    else if (wasEditing.current) editButton.current?.focus({ preventScroll: true });
    wasEditing.current = editing;
  }, [editing]);
  return <section className={styles.panel} aria-label="Card identity">
    <div className={styles.heading}><h2>Card details</h2>{!editing && !readOnly && <button ref={editButton} type="button" disabled={disabled} onClick={onEdit}>Edit card details</button>}</div>
    {editing ? <form noValidate onSubmit={event => { event.preventDefault(); if (!saving) onSave(); }} onKeyDown={event => {
      if (event.key === 'Escape' && !saving) { event.preventDefault(); event.stopPropagation(); onCancel(); }
    }}>
      <fieldset className={styles.fields} disabled={saving || readOnly}>
        {fields.map(({ key, label, options, maxLength = 120, placeholder }, index) => <label key={key} className={!String(draft[key] ?? '').trim() ? styles.missingField : undefined}>
          <span>{label}</span>{options ? <select aria-label={label} aria-invalid={Boolean(errors[key])} value={draft[key] ?? ''} onChange={event => onChange(key, event.target.value)}>
            <option value="">Not set</option>{options.map(value => <option key={value} value={value}>{kindNames[value]}</option>)}
          </select> : <input ref={index === 0 ? firstInput : undefined} aria-label={label} aria-invalid={Boolean(errors[key])} value={draft[key] ?? ''} maxLength={maxLength} placeholder={placeholder ?? 'Not set'} onChange={event => onChange(key, event.target.value)} />}
          {errors[key] && <small className={styles.error} role="alert">{errors[key]}</small>}
        </label>)}
      </fieldset>
      {errors.identity && <p className={styles.error} role="alert">{errors.identity}</p>}
      <div className={styles.actions}><p>Your outlines and findings stay saved.</p><button type="button" disabled={saving} onClick={onCancel}>Cancel</button><button type="submit" className={styles.save} disabled={saving || readOnly}>{saving ? 'Saving…' : reviewIdentityChanged(identity, draft) ? 'Save details' : 'Done'}</button></div>
    </form> : <dl className={styles.summary}>{fields.map(({ key, label }) => <div key={key}><dt>{label}</dt><dd className={!identity[key] ? styles.missing : undefined}>{key === 'layoutType' ? kindNames[identity[key]] ?? 'Not set' : identity[key] || 'Not set'}</dd></div>)}</dl>}
  </section>;
}
