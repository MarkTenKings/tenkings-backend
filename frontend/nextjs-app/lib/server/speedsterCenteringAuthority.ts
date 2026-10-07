import type { SpeedsterCardSide } from "../ai-grader-v2/contracts";
import { measureSpeedsterCenteringBorders } from "../ai-grader-v2/scoring";
import { HttpError } from "./adminSessionAuthority";

// Call only with the confirmed capture quad: browser/stored border numbers
// are never an input to new capture, review, or completion authority.
export function speedsterCenteringFromConfirmedQuad(value: unknown, side: SpeedsterCardSide) {
  try {
    return measureSpeedsterCenteringBorders(value);
  } catch {
    throw new HttpError(409, `${side} printed-frame geometry cannot provide valid centering measurements.`);
  }
}
