/** Browser-safe contact contract. The verified phone belongs to account authority,
 * never to this customer-editable document. Return addresses are a separate shape. */
export function contactProfileInput(value) {
  const fail=()=>{throw Object.assign(new Error('CONTACT_DETAILS_REQUIRED'),{code:'CONTACT_DETAILS_REQUIRED'});};
  if(!value||typeof value!=='object'||Array.isArray(value)||!Object.hasOwn(value,'name')||Object.keys(value).some(key=>!['name','email'].includes(key)))fail();
  const result={};
  for(const key of Object.keys(value)){
    if(typeof value[key]!=='string'||value[key].length>(key==='name'?120:254)||/[\x00-\x1f\x7f]/.test(value[key]))fail();
    result[key]=value[key].trim();
  }
  if(!result.name||result.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email))fail();
  return result;
}
export function shopProfile(value) { return contactProfileInput({name:value?.name,email:value?.email??''}); }
