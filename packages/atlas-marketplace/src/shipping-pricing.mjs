import { cents, clone, hash, requireValue, sumCents } from './contract.mjs';
import { authorityContext, domainId } from './authority-context.mjs';
import { exactKeys, exactTime } from './fee-policy.mjs';

export const SHIPPING_PRICING_POLICY_SCHEMA = 'atlas-shipping-pricing-policy-v1';
export const SHIPPING_PRICING_RECEIPT_SCHEMA = 'atlas-shipping-pricing-receipt-v1';
export const PILOT_SHIPPING_HANDLING_CENTS = 300;
const label = 'Shipping & handling';
const disclosure = 'Includes the carrier quote plus a $3.00 ATLAS packaging and handling charge.';
const text = value => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 1000 && !/[\u0000-\u001f\u007f]/.test(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const inputKeys = ['id','version','environment','approvalRef','effectiveAt','expiresAt','shippingTaxCode','maxBuyerChargeCents'];
const policyKeys = ['schema',...inputKeys,'currency','handlingCents','label','disclosure','refundAttribution'];
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

export function assertShippingPricingPolicy(policy, { environment, now } = {}) {
  exactKeys(policy, policyKeys, 'SHIPPING_PRICING_POLICY_INVALID');
  requireValue(policy.schema === SHIPPING_PRICING_POLICY_SCHEMA && ['SYNTHETIC_LOCAL','PROVIDER_SANDBOX','PRODUCTION'].includes(policy.environment) && (environment === undefined || policy.environment === environment), 'SHIPPING_PRICING_POLICY_INVALID');
  requireValue(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(policy.id) && !['constructor','prototype'].includes(policy.id) && ['version','approvalRef'].every(key => text(policy[key])), 'SHIPPING_PRICING_POLICY_INVALID');
  requireValue(policy.currency === 'USD' && policy.handlingCents === PILOT_SHIPPING_HANDLING_CENTS && policy.label === label && policy.disclosure === disclosure && policy.refundAttribution === 'PRO_RATA_REMAINING_HALF_UP' && /^txcd_\d{8}$/.test(policy.shippingTaxCode), 'SHIPPING_PRICING_POLICY_INVALID');
  cents(policy.maxBuyerChargeCents, { positive: true }); requireValue(policy.maxBuyerChargeCents >= policy.handlingCents, 'SHIPPING_PRICING_POLICY_INVALID');
  const from = exactTime(policy.effectiveAt), to = exactTime(policy.expiresAt);
  requireValue(to > from, 'SHIPPING_PRICING_POLICY_INVALID');
  if (now !== undefined) requireValue(Number.isSafeInteger(now) && from <= now && to > now, 'SHIPPING_PRICING_POLICY_EXPIRED');
  return policy;
}

// Data construction only: no enabled default, inferred authority, tax code,
// rate cap, provider account, or effect. Host checkout approval remains required.
export function createPilotShippingPricing(input, suppliedContext) {
  const context = authorityContext(suppliedContext);
  exactKeys(input, inputKeys, 'SHIPPING_PRICING_INPUT_REQUIRED');
  domainId(input.id, 'shipping pricing policy', context);
  const result = { schema: SHIPPING_PRICING_POLICY_SCHEMA, ...clone(input), currency: 'USD', handlingCents: PILOT_SHIPPING_HANDLING_CENTS, label, disclosure, refundAttribution: 'PRO_RATA_REMAINING_HALF_UP' };
  assertShippingPricingPolicy(result, { environment: context.environment }); return freeze(result);
}

export function createShippingPricingReceipt({ policy, providerReceipt, issuedAt, expiresAt }) {
  const now = exactTime(issuedAt); assertShippingPricingPolicy(policy, { now });
  cents(providerReceipt?.amountCents); requireValue(providerReceipt.currency === 'USD' && text(providerReceipt.quoteRef), 'SHIPPING_COST_RECEIPT_REQUIRED');
  const content = { schema: SHIPPING_PRICING_RECEIPT_SCHEMA, environment: policy.environment, currency: 'USD', policy: clone(policy), policyHash: hash(policy), providerCostReceiptHash: hash(providerReceipt), providerQuoteRef: providerReceipt.quoteRef,
    quotedCarrierCostCents: providerReceipt.amountCents, handlingCents: policy.handlingCents, buyerChargeCents: sumCents(providerReceipt.amountCents, policy.handlingCents), label, disclosure, costStatus: 'QUOTED_NOT_SETTLED', issuedAt, expiresAt };
  const result = { ...content, receiptHash: hash(content) };
  assertShippingPricingReceipt(result, { providerReceipt, now }); return freeze(result);
}

export function assertShippingPricingReceipt(receipt, { shippingCents, providerReceipt, environment, now } = {}) {
  exactKeys(receipt, ['schema','environment','currency','policy','policyHash','providerCostReceiptHash','providerQuoteRef','quotedCarrierCostCents','handlingCents','buyerChargeCents','label','disclosure','costStatus','issuedAt','expiresAt','receiptHash'], 'SHIPPING_PRICING_RECEIPT_INVALID');
  assertShippingPricingPolicy(receipt.policy, { environment: environment ?? receipt.environment });
  const { receiptHash, ...content } = receipt;
  requireValue(receipt.schema === SHIPPING_PRICING_RECEIPT_SCHEMA && receiptHash === hash(content) && receipt.policyHash === hash(receipt.policy) && receipt.environment === receipt.policy.environment && receipt.currency === 'USD' && digest(receipt.providerCostReceiptHash) && text(receipt.providerQuoteRef), 'SHIPPING_PRICING_RECEIPT_INVALID');
  cents(receipt.quotedCarrierCostCents); cents(receipt.buyerChargeCents);
  requireValue(receipt.handlingCents === receipt.policy.handlingCents && receipt.buyerChargeCents === sumCents(receipt.quotedCarrierCostCents, receipt.handlingCents) && receipt.buyerChargeCents <= receipt.policy.maxBuyerChargeCents && (shippingCents === undefined || shippingCents === receipt.buyerChargeCents), 'SHIPPING_PRICING_AMOUNT_MISMATCH');
  requireValue(receipt.label === label && receipt.disclosure === disclosure && receipt.costStatus === 'QUOTED_NOT_SETTLED', 'SHIPPING_PRICING_RECEIPT_INVALID');
  const issued = exactTime(receipt.issuedAt), expires = exactTime(receipt.expiresAt);
  requireValue(issued >= exactTime(receipt.policy.effectiveAt) && expires <= exactTime(receipt.policy.expiresAt) && expires > issued, 'SHIPPING_PRICING_RECEIPT_INVALID');
  if (now !== undefined) requireValue(Number.isSafeInteger(now) && issued <= now && expires > now, 'SHIPPING_PRICING_EXPIRED');
  if (providerReceipt !== undefined) requireValue(receipt.providerCostReceiptHash === hash(providerReceipt) && receipt.providerQuoteRef === providerReceipt.quoteRef && receipt.quotedCarrierCostCents === providerReceipt.amountCents && providerReceipt.currency === 'USD' && exactTime(providerReceipt.issuedAt) <= issued && exactTime(providerReceipt.expiresAt) >= expires, 'SHIPPING_COST_BINDING_MISMATCH');
  return receipt;
}

// Allocation describes refund attribution, not actual postage or profit. Use
// remaining component amounts so each cent stays capped and the final refund
// consumes the exact remainder, including earlier rounding or failed refunds.
export function allocateShippingRefund(receipt, amountCents, previous = []) {
  assertShippingPricingReceipt(receipt); cents(amountCents);
  let carrier = receipt.quotedCarrierCostCents, handling = receipt.handlingCents;
  for (const value of previous) {
    exactKeys(value, ['carrierCents','handlingCents'], 'SHIPPING_REFUND_ALLOCATION_INVALID'); cents(value.carrierCents); cents(value.handlingCents);
    carrier -= value.carrierCents; handling -= value.handlingCents;
  }
  cents(carrier); cents(handling); const remaining = sumCents(carrier, handling);
  requireValue(amountCents <= remaining, 'EXCESS_SHIPPING_REFUND');
  if (amountCents === 0) return { carrierCents: 0, handlingCents: 0 };
  const numerator = BigInt(amountCents) * BigInt(carrier), denominator = BigInt(remaining);
  const rounded = Number(numerator / denominator + ((numerator % denominator) * 2n >= denominator ? 1n : 0n));
  const carrierCents = Math.min(carrier, Math.max(amountCents - handling, rounded));
  return { carrierCents, handlingCents: amountCents - carrierCents };
}
