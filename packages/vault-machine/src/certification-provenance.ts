import { parseJson } from "./util";

/** Evidence follows the immutable session identities, never a later adapter probe.
 * The legacy adapter_mode field separately controls simulated cycle availability. */
export function certificationObservationEvidenceClass(session: Record<string, unknown>): "AUTOMATED" | "FULL_MACHINE" {
  const controller = parseJson<{ mode?: string }>(session.controller_identity_json);
  const payment = parseJson<{ mode?: string }>(session.payment_identity_json);
  return session.adapter_mode === "MOCK" || controller.mode === "MOCK" || payment.mode === "MOCK" ? "AUTOMATED" : "FULL_MACHINE";
}
