import {shopProfile} from '@atlas/customer-intake/profile';
export const emptyProfile = { name: '', email: '', address1: '', address2: '', city: '', region: '', postalCode: '', country: 'US' };
export const intakeProfile=(value,intakeMethod='MAIL_IN')=>intakeMethod==='DEALER_DROP_OFF'?shopProfile(value):{...value};
export const completeProfile = (value,intakeMethod='MAIL_IN') => {
  if(intakeMethod==='DEALER_DROP_OFF'){try{shopProfile(value);return true;}catch{return false;}}
  return Boolean(value && ['name', 'email', 'address1', 'city', 'postalCode', 'country'].every(key => typeof value[key] === 'string' && value[key].trim()) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email));
};
export default function ProfileFields({ value, onChange, disabled, intakeMethod='MAIL_IN' }) {
  const shop=intakeMethod==='DEALER_DROP_OFF';
  const fields = [['name', 'Full name', 'name', 120], ['email', 'Email for your receipt', 'email', 254], ['address1', 'Street address', 'address-line1', 200],
    ['address2', 'Apartment, suite, etc. (optional)', 'address-line2', 200], ['city', 'City', 'address-level2', 100], ['region', 'State / province / region', 'address-level1', 100],
    ['postalCode', 'Postal code', 'postal-code', 30], ['country', 'Country code', 'country', 2]];
  return <div className="fields">{fields.filter(([key])=>!shop||['name','email'].includes(key)).map(([key, label, autocomplete, max]) => <label key={key} className={['name', 'email', 'address1', 'address2'].includes(key) ? 'wide' : ''}>
    <span>{shop&&key==='email'?'Email for your receipt (optional)':label}</span><input value={value[key] ?? ''} type={key === 'email' ? 'email' : 'text'} autoComplete={['name','email'].includes(key)?autocomplete:`shipping ${autocomplete}`} maxLength={max}
      required={!['address2', 'region'].includes(key)&&!(shop&&key==='email')} disabled={disabled} onChange={event => onChange({ ...value, [key]: event.target.value })}
      {...(key === 'country' ? { placeholder: 'US', pattern: '[A-Za-z]{2}', style: { textTransform: 'uppercase' } } : {})}/>
  </label>)}</div>;
}
