import { financeAssert as check } from './ledger.mjs';
import { createStripeAuthorization, createStripeProvider } from './provider-stripe.mjs';

// Backwards-compatible sandbox-only entrypoint. Live options/keys cannot loosen this boundary.
export function createStripeSandboxProvider({ authorizedSandbox = false, secretKey, publishableKey, platformAccountId, allowedConnectedAccountIds, allowedReturnOrigins = [], apiVersion, fetch, clock } = {}) {
  check(authorizedSandbox === true, 'STRIPE_SANDBOX_NOT_AUTHORIZED');
  check(typeof secretKey === 'string' && /^(sk|rk)_test_[A-Za-z0-9]+$/.test(secretKey), 'STRIPE_TEST_KEY_REQUIRED');
  const authorization = createStripeAuthorization({ environment: 'PROVIDER_SANDBOX', platformAccountId, allowedConnectedAccountIds, allowedReturnOrigins, apiVersion });
  return createStripeProvider({ authorization, secretKey, publishableKey, ...(fetch ? { fetch } : {}), ...(clock ? { clock } : {}) });
}
