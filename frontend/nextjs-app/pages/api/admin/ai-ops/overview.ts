import type { NextApiRequest, NextApiResponse } from "next";
import { prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../lib/server/admin";

const MS_24H = 24 * 60 * 60 * 1000;
const MS_7D = 7 * 24 * 60 * 60 * 1000;
const MS_14D = 14 * 24 * 60 * 60 * 1000;

type WindowAccumulator = {
  processed: number;
  llmParsed: number;
  fallbackUsed: number;
  multimodalUsed: number;
  multimodalHighDetail: number;
  jsonObjectFormat: number;
  variantMatchOk: number;
  memoryAppliedCards: number;
  memoryAppliedEntries: number;
  timingTotalMs: number[];
  timingOcrMs: number[];
  timingLlmMs: number[];
  photoFrontOk: number;
  photoBackOk: number;
  photoTiltOk: number;
};

type AttentionCard = {
  id: string;
  fileName: string;
  reviewStage: string | null;
  updatedAt: string;
  issues: string[];
  model: string | null;
  fallbackUsed: boolean;
};

type OverviewResponse =
  | {
      generatedAt: string;
      config: {
        ocrProvider: "google-vision";
        llmEndpoint: "responses";
        primaryModel: string;
        fallbackModel: string;
      };
      live: {
        last24h: ReturnType<typeof summarizeWindow>;
        last7d: ReturnType<typeof summarizeWindow>;
      };
      models: {
        byModel: Array<{ model: string; count: number }>;
        byFormat: Array<{ format: string; count: number }>;
      };
      teach: {
        lessons7d: number;
        corrections7d: number;
        accuracy7dPct: number | null;
        accuracyPrev7dPct: number | null;
        accuracyDeltaPct: number | null;
        topCorrectedFields: Array<{ field: string; count: number }>;
        recentCorrections: Array<{
          cardId: string;
          fileName: string | null;
          fieldName: string;
          modelValue: string | null;
          humanValue: string | null;
          createdAt: string;
        }>;
      };
      ops: {
        attentionCards: AttentionCard[];
      };
    }
  | { message: string };

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function toText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function toNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

function percentage(numerator: number, denominator: number): number | null {
  if (denominator <= 0) {
    return null;
  }
  return Number(((numerator / denominator) * 100).toFixed(1));
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  const picked = sorted[index];
  return Number(picked.toFixed(1));
}

function createWindowAccumulator(): WindowAccumulator {
  return {
    processed: 0,
    llmParsed: 0,
    fallbackUsed: 0,
    multimodalUsed: 0,
    multimodalHighDetail: 0,
    jsonObjectFormat: 0,
    variantMatchOk: 0,
    memoryAppliedCards: 0,
    memoryAppliedEntries: 0,
    timingTotalMs: [],
    timingOcrMs: [],
    timingLlmMs: [],
    photoFrontOk: 0,
    photoBackOk: 0,
    photoTiltOk: 0,
  };
}

function summarizeWindow(window: WindowAccumulator) {
  return {
    processed: window.processed,
    llmParsed: window.llmParsed,
    llmParseRatePct: percentage(window.llmParsed, window.processed),
    fallbackUsed: window.fallbackUsed,
    fallbackRatePct: percentage(window.fallbackUsed, window.llmParsed),
    multimodalUsed: window.multimodalUsed,
    multimodalUsedRatePct: percentage(window.multimodalUsed, window.llmParsed),
    multimodalHighDetail: window.multimodalHighDetail,
    multimodalHighDetailRatePct: percentage(window.multimodalHighDetail, window.multimodalUsed),
    jsonObjectFormat: window.jsonObjectFormat,
    jsonObjectRatePct: percentage(window.jsonObjectFormat, window.llmParsed),
    variantMatchOk: window.variantMatchOk,
    variantMatchOkRatePct: percentage(window.variantMatchOk, window.processed),
    memoryAppliedCards: window.memoryAppliedCards,
    memoryAppliedRatePct: percentage(window.memoryAppliedCards, window.processed),
    memoryAppliedEntries: window.memoryAppliedEntries,
    photoFrontOk: window.photoFrontOk,
    photoBackOk: window.photoBackOk,
    photoTiltOk: window.photoTiltOk,
    photoFrontOkRatePct: percentage(window.photoFrontOk, window.processed),
    photoBackOkRatePct: percentage(window.photoBackOk, window.processed),
    photoTiltOkRatePct: percentage(window.photoTiltOk, window.processed),
    latency: {
      totalMsP50: percentile(window.timingTotalMs, 50),
      totalMsP95: percentile(window.timingTotalMs, 95),
      ocrMsP50: percentile(window.timingOcrMs, 50),
      ocrMsP95: percentile(window.timingOcrMs, 95),
      llmMsP50: percentile(window.timingLlmMs, 50),
      llmMsP95: percentile(window.timingLlmMs, 95),
    },
  };
}

function incrementCounter(map: Map<string, number>, key: string | null) {
  if (!key) {
    return;
  }
  map.set(key, (map.get(key) ?? 0) + 1);
}

function toSortedArray(map: Map<string, number>, limit = 10): Array<{ key: string; count: number }> {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<OverviewResponse>) {
  try {
    await requireAdminSession(req);

    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ message: "Method not allowed" });
    }

    const now = Date.now();
    const since7d = new Date(now - MS_7D);
    const since14d = new Date(now - MS_14D);
    const since24hMs = now - MS_24H;
    const since7dMs = now - MS_7D;

    const primaryModel = (process.env.OCR_LLM_MODEL ?? "gpt-5").trim();
    const fallbackModel = (process.env.OCR_LLM_FALLBACK_MODEL ?? "gpt-5-mini").trim();

    const cardRows = await prisma.cardAsset.findMany({
      where: {
        ocrSuggestionUpdatedAt: {
          gte: since7d,
        },
      },
      orderBy: {
        ocrSuggestionUpdatedAt: "desc",
      },
      take: 5000,
      select: {
        id: true,
        fileName: true,
        reviewStage: true,
        ocrSuggestionUpdatedAt: true,
        ocrSuggestionJson: true,
      },
    });

    const last24h = createWindowAccumulator();
    const last7d = createWindowAccumulator();
    const modelCounts = new Map<string, number>();
    const formatCounts = new Map<string, number>();
    const attentionCards: AttentionCard[] = [];

    cardRows.forEach((row) => {
      const updatedAt = row.ocrSuggestionUpdatedAt;
      if (!updatedAt) {
        return;
      }
      const updatedMs = updatedAt.getTime();
      const in24h = updatedMs >= since24hMs;
      const in7d = updatedMs >= since7dMs;
      if (!in7d) {
        return;
      }

      const audit = toRecord(row.ocrSuggestionJson);
      const llm = toRecord(audit?.llm);
      const readiness = toRecord(audit?.readiness);
      const photoOcr = toRecord(audit?.photoOcr);
      const memory = toRecord(audit?.memory);
      const variantMatch = toRecord(audit?.variantMatch);
      const timings = toRecord(audit?.timings);

      const llmModel = toText(llm?.model);
      const llmFormat = toText(llm?.format);
      const fallbackUsed = llm?.fallbackUsed === true;
      const llmMode = toText(llm?.mode);
      const llmDetail = toText(llm?.detail);
      const memoryAppliedEntries = Array.isArray(memory?.applied) ? memory.applied.length : 0;
      const variantMatchOk = variantMatch?.ok === true;
      const frontStatus = toText(toRecord(photoOcr?.FRONT)?.status);
      const backStatus = toText(toRecord(photoOcr?.BACK)?.status);
      const tiltStatus = toText(toRecord(photoOcr?.TILT)?.status);

      const windowTargets = [last7d, ...(in24h ? [last24h] : [])];
      windowTargets.forEach((window) => {
        window.processed += 1;
        if (llm) {
          window.llmParsed += 1;
        }
        if (fallbackUsed) {
          window.fallbackUsed += 1;
        }
        if (llmMode === "multimodal") {
          window.multimodalUsed += 1;
          if (llmDetail === "high") {
            window.multimodalHighDetail += 1;
          }
        }
        if (llmFormat === "json_object") {
          window.jsonObjectFormat += 1;
        }
        if (variantMatchOk) {
          window.variantMatchOk += 1;
        }
        if (memoryAppliedEntries > 0) {
          window.memoryAppliedCards += 1;
          window.memoryAppliedEntries += memoryAppliedEntries;
        }
        if (frontStatus === "ok") {
          window.photoFrontOk += 1;
        }
        if (backStatus === "ok") {
          window.photoBackOk += 1;
        }
        if (tiltStatus === "ok") {
          window.photoTiltOk += 1;
        }

        const totalMs = toNumber(timings?.totalMs);
        const ocrMs = toNumber(timings?.ocrMs);
        const llmMs = toNumber(timings?.llmMs);
        if (totalMs != null) {
          window.timingTotalMs.push(totalMs);
        }
        if (ocrMs != null) {
          window.timingOcrMs.push(ocrMs);
        }
        if (llmMs != null) {
          window.timingLlmMs.push(llmMs);
        }
      });

      incrementCounter(modelCounts, llmModel);
      incrementCounter(formatCounts, llmFormat);

      const issues: string[] = [];
      if (!llm) issues.push("llm-missing");
      if (fallbackUsed) issues.push("fallback-used");
      if (llmFormat === "json_object") issues.push("json-object-format");
      if (variantMatch?.ok === false) issues.push("variant-match-failed");
      const readinessStatus = toText(readiness?.status);
      if (readinessStatus && readinessStatus !== "ready") issues.push(`readiness-${readinessStatus}`);
      if (frontStatus && frontStatus !== "ok") issues.push(`front-${frontStatus}`);
      if (backStatus && backStatus !== "ok") issues.push(`back-${backStatus}`);
      if (tiltStatus && tiltStatus !== "ok") issues.push(`tilt-${tiltStatus}`);

      if (issues.length > 0 && attentionCards.length < 80) {
        attentionCards.push({
          id: row.id,
          fileName: row.fileName,
          reviewStage: row.reviewStage ?? null,
          updatedAt: updatedAt.toISOString(),
          issues: Array.from(new Set(issues)),
          model: llmModel,
          fallbackUsed,
        });
      }
    });

    const feedbackRows = (await (prisma as any).ocrFeedbackEvent.findMany({
      where: {
        createdAt: {
          gte: since14d,
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 20000,
      select: {
        cardAssetId: true,
        fieldName: true,
        modelValue: true,
        humanValue: true,
        wasCorrect: true,
        createdAt: true,
      },
    })) as Array<{
      cardAssetId: string;
      fieldName: string;
      modelValue: string | null;
      humanValue: string | null;
      wasCorrect: boolean;
      createdAt: Date;
    }>;

    const correctedFieldCounts = new Map<string, number>();
    const lessons7dRows: typeof feedbackRows = [];
    const lessonsPrev7dRows: typeof feedbackRows = [];
    const recentCorrectionsRaw: Array<{
      cardId: string;
      fieldName: string;
      modelValue: string | null;
      humanValue: string | null;
      createdAt: string;
    }> = [];

    feedbackRows.forEach((row) => {
      const createdMs = row.createdAt.getTime();
      const in7d = createdMs >= since7dMs;
      const inPrev7d = createdMs < since7dMs && createdMs >= now - MS_14D;
      if (in7d) {
        lessons7dRows.push(row);
      } else if (inPrev7d) {
        lessonsPrev7dRows.push(row);
      }

      const corrected = row.wasCorrect === false;
      if (in7d && corrected) {
        correctedFieldCounts.set(row.fieldName, (correctedFieldCounts.get(row.fieldName) ?? 0) + 1);
        if (recentCorrectionsRaw.length < 25) {
          recentCorrectionsRaw.push({
            cardId: row.cardAssetId,
            fieldName: row.fieldName,
            modelValue: toText(row.modelValue),
            humanValue: toText(row.humanValue),
            createdAt: row.createdAt.toISOString(),
          });
        }
      }
    });

    const correctionCardIds = Array.from(new Set(recentCorrectionsRaw.map((row) => row.cardId).filter(Boolean)));
    const correctionCards =
      correctionCardIds.length > 0
        ? await prisma.cardAsset.findMany({
            where: {
              id: {
                in: correctionCardIds,
              },
            },
            select: {
              id: true,
              fileName: true,
            },
          })
        : [];
    const correctionCardMap = new Map(correctionCards.map((row) => [row.id, row.fileName]));

    const corrections7d = lessons7dRows.filter((row) => row.wasCorrect === false).length;
    const accuracy7dPct = percentage(
      lessons7dRows.filter((row) => row.wasCorrect === true).length,
      lessons7dRows.length
    );
    const accuracyPrev7dPct = percentage(
      lessonsPrev7dRows.filter((row) => row.wasCorrect === true).length,
      lessonsPrev7dRows.length
    );
    const accuracyDeltaPct =
      accuracy7dPct == null || accuracyPrev7dPct == null
        ? null
        : Number((accuracy7dPct - accuracyPrev7dPct).toFixed(1));

    const modelRows = toSortedArray(modelCounts, 12).map((entry) => ({ model: entry.key, count: entry.count }));
    const formatRows = toSortedArray(formatCounts, 6).map((entry) => ({ format: entry.key, count: entry.count }));
    const correctedFieldRows = toSortedArray(correctedFieldCounts, 8).map((entry) => ({
      field: entry.key,
      count: entry.count,
    }));

    const recentCorrections = recentCorrectionsRaw.map((row) => ({
      cardId: row.cardId,
      fileName: correctionCardMap.get(row.cardId) ?? null,
      fieldName: row.fieldName,
      modelValue: row.modelValue,
      humanValue: row.humanValue,
      createdAt: row.createdAt,
    }));

    attentionCards.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

    return res.status(200).json({
      generatedAt: new Date().toISOString(),
      config: {
        ocrProvider: "google-vision",
        llmEndpoint: "responses",
        primaryModel,
        fallbackModel,
      },
      live: {
        last24h: summarizeWindow(last24h),
        last7d: summarizeWindow(last7d),
      },
      models: {
        byModel: modelRows,
        byFormat: formatRows,
      },
      teach: {
        lessons7d: lessons7dRows.length,
        corrections7d,
        accuracy7dPct,
        accuracyPrev7dPct,
        accuracyDeltaPct,
        topCorrectedFields: correctedFieldRows,
        recentCorrections,
      },
      ops: {
        attentionCards: attentionCards.slice(0, 24),
      },
    });
  } catch (error) {
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
