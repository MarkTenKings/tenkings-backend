import { HttpError } from "./adminSessionAuthority";
import { prepareSpeedsterSide, type SpeedsterPreparationServiceDependencies } from "./speedsterPreparationService";

// This is the reviewed private CPU host, not detector or artifact admission.
const preparationOrigin = "https://prepare.atlasgrading.com";
type PreparationTransport = Readonly<{ origin: string; headers: Readonly<Record<string, string>> }>;

export function legacySpeedsterPreparationTransport(env: Readonly<NodeJS.ProcessEnv>): PreparationTransport {
  const origin = env.AI_GRADER_SPEEDSTER_PREPARATION_SERVICE_URL;
  const key = env.AI_GRADER_SPEEDSTER_PREPARATION_SERVICE_API_KEY;
  const detectorKey = env.AI_GRADER_SPEEDSTER_SERVICE_API_KEY?.trim();
  let detectorOrigin: string | undefined;
  try { detectorOrigin = new URL(env.AI_GRADER_SPEEDSTER_SERVICE_URL ?? "").origin; } catch { /* No detector fallback. */ }
  if (origin !== preparationOrigin || !key || !/^[A-Za-z0-9_+/=-]{32,128}$/.test(key)
    || key === detectorKey || detectorOrigin === preparationOrigin) {
    throw new HttpError(503, "Dedicated image preparation is not configured. Your photos and saved draft remain available.");
  }
  return Object.freeze({ origin, headers: Object.freeze({ "Content-Type": "application/json", Authorization: `Bearer ${key}` }) });
}

type Dependencies = Omit<SpeedsterPreparationServiceDependencies, "invokeWorker"> & {
  invokeWorker: (body: Record<string, unknown>, transport: PreparationTransport) => ReturnType<SpeedsterPreparationServiceDependencies["invokeWorker"]>;
};

/** Recovery remains read-only; fresh work binds its release and CPU transport before any source read or claim. */
export function prepareLegacySpeedsterSide(raw: unknown, createdByUserId: string, deps: Dependencies, env: Readonly<NodeJS.ProcessEnv> = process.env) {
  const capturedEnv = Object.freeze({ ...env });
  let transport: PreparationTransport | undefined;
  return prepareSpeedsterSide(raw, createdByUserId, {
    ...deps,
    approvedRelease: () => {
      const release = deps.approvedRelease();
      transport = legacySpeedsterPreparationTransport(capturedEnv);
      return release;
    },
    invokeWorker: (body) => {
      if (!transport) throw new HttpError(503, "Verified image preparation is unavailable.");
      return deps.invokeWorker(body, transport);
    },
  });
}
