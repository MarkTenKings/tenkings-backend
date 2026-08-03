import { prisma, type Prisma } from "@tenkings/database";
import {
  createSpeedsterPresentationImages,
  type SpeedsterPresentationImageInput,
} from "./aiGraderV2PresentationImages";

type CardSide = "FRONT" | "BACK";
type PresentationResult = {
  frontCleanStorageKey: string;
  backCleanStorageKey: string;
};
type Dependencies = {
  findCompletedSession: (sessionId: string, createdByUserId: string) => Promise<{ capture: unknown } | null>;
  saveCapture: (sessionId: string, createdByUserId: string, capture: Prisma.InputJsonValue) => Promise<boolean>;
  createImages: (input: {
    front: SpeedsterPresentationImageInput;
    back: SpeedsterPresentationImageInput;
  }) => Promise<PresentationResult>;
};

const dependencies: Dependencies = {
  findCompletedSession: (id, createdByUserId) => prisma.aiGraderV2Session.findFirst({
    where: { id, createdByUserId, workflowState: "COMPLETED" },
    select: { capture: true },
  }),
  saveCapture: async (id, createdByUserId, capture) => {
    const result = await prisma.aiGraderV2Session.updateMany({
      where: { id, createdByUserId, workflowState: "COMPLETED" },
      data: { capture },
    });
    return result.count === 1;
  },
  createImages: createSpeedsterPresentationImages,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;

export function speedsterPresentationStorageKey(input: {
  createdByUserId: string;
  sessionId: string;
  side: CardSide;
}) {
  return `ai-grader-v2/${input.createdByUserId}/${input.sessionId}/report/${input.side.toLowerCase()}-clean.png`;
}

export async function completeSpeedsterPresentationImages(input: {
  sessionId: string;
  createdByUserId: string;
}, deps: Dependencies = dependencies) {
  const session = await deps.findCompletedSession(input.sessionId, input.createdByUserId);
  if (!session || !isRecord(session.capture)) {
    throw new Error("Completed Speedster capture is unavailable for presentation images.");
  }

  const front = isRecord(session.capture.front) ? session.capture.front : null;
  const back = isRecord(session.capture.back) ? session.capture.back : null;
  if (!front || !back) throw new Error("Completed Speedster capture is missing Front or Back evidence.");

  const existingFront = text(front.reportStorageKey);
  const existingBack = text(back.reportStorageKey);
  if (existingFront && existingBack) {
    return { outcome: "EXISTING" as const, frontCleanStorageKey: existingFront, backCleanStorageKey: existingBack };
  }

  const frontSourceStorageKey = text(front.inspectionStorageKey) ?? text(front.rectifiedStorageKey);
  const backSourceStorageKey = text(back.inspectionStorageKey) ?? text(back.rectifiedStorageKey);
  if (!frontSourceStorageKey || !backSourceStorageKey) {
    throw new Error("Completed Speedster capture is missing Front or Back presentation evidence.");
  }

  const frontOutputStorageKey = speedsterPresentationStorageKey({ ...input, side: "FRONT" });
  const backOutputStorageKey = speedsterPresentationStorageKey({ ...input, side: "BACK" });
  const created = await deps.createImages({
    front: {
      sourceStorageKey: frontSourceStorageKey,
      sourceContentType: "image/webp",
      outputStorageKey: frontOutputStorageKey,
    },
    back: {
      sourceStorageKey: backSourceStorageKey,
      sourceContentType: "image/webp",
      outputStorageKey: backOutputStorageKey,
    },
  });
  const capture = {
    ...session.capture,
    front: { ...front, reportStorageKey: created.frontCleanStorageKey },
    back: { ...back, reportStorageKey: created.backCleanStorageKey },
  } as Prisma.InputJsonValue;
  if (!await deps.saveCapture(input.sessionId, input.createdByUserId, capture)) {
    throw new Error("Completed Speedster presentation images could not be saved.");
  }
  return { outcome: "CREATED" as const, ...created };
}
