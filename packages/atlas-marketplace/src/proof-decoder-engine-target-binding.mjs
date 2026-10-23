import {requireValue} from './contract.mjs';
import {assertProofDecoderLaunchPlan,decoderFreeze} from './proof-decoder-profile.mjs';
import {engineDataOptions,parseProofDecoderEngineJSON} from './proof-decoder-engine-json.mjs';

const bindings=new WeakMap();
const check=value=>requireValue(value,'ENGINE_FIXED_PARENT_BINDING_REQUIRED');

/** Sealed encoding choice only. This is NOT a kernel, guard or admission token.
 * There is exactly one parent spelling and no caller path/parent override.
 */
export function createProofDecoderFixedParentBinding(options={}) {
  const input=engineDataOptions(options,[],['enabled','plan']);
  if(input.enabled!==true)return null;
  const plan=assertProofDecoderLaunchPlan(input.plan);
  const binding=decoderFreeze({classification:'UNQUALIFIED',executionAllowed:false,
    role:'FIXED_PARENT_ENCODING_ONLY',cgroupParent:'atlasdecoder.slice',profileHash:plan.profileHash,limitsHash:plan.limitsHash});
  bindings.set(binding,{profileHash:plan.profileHash,limitsHash:plan.limitsHash});return binding;
}
export function assertProofDecoderFixedParentBinding(binding,{plan}) {
  const known=bindings.get(binding);check(known?.profileHash===plan.profileHash&&known.limitsHash===plan.limitsHash);return binding;
}

/** Private-body check: only structural Engine agreement, never kernel mapping.
 * No raw Config.Env, mounts, error strings or unrelated response data escapes.
 */
export function assertProofDecoderFixedParentReport({body,targetBinding,plan}) {
  const binding=assertProofDecoderFixedParentBinding(targetBinding,{plan});
  const value=parseProofDecoderEngineJSON(body);
  check(value&&Object.getPrototypeOf(value)===Object.prototype&&value.HostConfig&&
    Object.getPrototypeOf(value.HostConfig)===Object.prototype&&value.HostConfig.CgroupParent===binding.cgroupParent);
  return true;
}
