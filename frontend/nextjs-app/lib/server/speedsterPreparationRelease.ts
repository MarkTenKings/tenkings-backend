import type { SpeedsterPreparationIdentity } from "../ai-grader-v2/preparation";
import { HttpError } from "./adminSessionAuthority";

// The currently signed detector image predates the preparation evidence response.
// Admit a new exact CPU preparation image here only after its source, signed image
// and observed CPU contract have been reviewed. Environment/tag claims cannot
// activate an unreviewed release. Existing detector admission is independent.
const approvedPreparationRelease: SpeedsterPreparationIdentity | null = null;

export function currentSpeedsterPreparationRelease(): SpeedsterPreparationIdentity {
  if (!approvedPreparationRelease) {
    throw new HttpError(503, "Verified image preparation is waiting for its compatible release. Your photos and saved draft remain available.");
  }
  return structuredClone(approvedPreparationRelease);
}
