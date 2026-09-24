export const emptyProfile = { name: '', email: '', address1: '', address2: '', city: '', region: '', postalCode: '', country: 'US' };
export const completeProfile = value => value && ['name', 'email', 'address1', 'city', 'postalCode', 'country'].every(key => typeof value[key] === 'string' && value[key].trim()) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email);
export default function ProfileFields({ value, onChange, disabled }) {
  const fields = [['name', 'Full name', 'name', 120], ['email', 'Email for your receipt', 'email', 254], ['address1', 'Street address', 'address-line1', 200],
    ['address2', 'Apartment, suite, etc. (optional)', 'address-line2', 200], ['city', 'City', 'address-level2', 100], ['region', 'State / province / region', 'address-level1', 100],
    ['postalCode', 'Postal code', 'postal-code', 30], ['country', 'Country code', 'country', 2]];
  return <div className="fields">{fields.map(([key, label, autocomplete, max]) => <label key={key} className={['name', 'email', 'address1', 'address2'].includes(key) ? 'wide' : ''}>
    <span>{label}</span><input value={value[key] ?? ''} type={key === 'email' ? 'email' : 'text'} autoComplete={key === 'email' ? 'email' : `shipping ${autocomplete}`} maxLength={max}
      required={!['address2', 'region'].includes(key)} disabled={disabled} onChange={event => onChange({ ...value, [key]: event.target.value })}
      {...(key === 'country' ? { placeholder: 'US', pattern: '[A-Za-z]{2}', style: { textTransform: 'uppercase' } } : {})}/>
  </label>)}</div>;
}
