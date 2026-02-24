import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "node:crypto";
import { Prisma, prisma } from "@tenkings/database";
import { requireAdminSession, toErrorResponse } from "../../../../../lib/server/admin";
import {
  evaluateOcrEvalCases,
  listEnabledOcrEvalCases,
  type OcrEvalExpected,
  type OcrEvalTopCandidates,
  type OcrEvalCaseMeta,
} from "../../../../../lib/server/ocrEvalFramework";

type RunEvalResponse =
  | {
      runId: string;
      status: "COMPLETED";
      caseCount: number;
      summary: ReturnType<typeof evaluateOcrEvalCases>["summary"];
      failedCases: Array<{
        slug: string;
        title: string;
        cardAssetId: string;
        notes: string[];
      }>;
    }
  | { message: string };

type OcrSuggestAudit = Record<string, unknown>;

function readHeaderFirst(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return String(value[0] || "").trim();
  }
  return String(value || "").trim();
}

function isSecretMatch(candidate: string, secret: string): boolean {
  if (!candidate || !secret) {
    return false;
  }
  const a = Buffer.from(candidate);
  const b = Buffer.from(secret);
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function toLabelList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter(Boolean);
}

function appendUnique(list: string[], incoming: string[]) {
  const existing = new Set(list.map((entry) => entry.toLowerCase()));
  incoming.forEach((entry) => {
    const normalized = entry.toLowerCase();
    if (!existing.has(normalized)) {
      existing.add(normalized);
      list.push(entry);
    }
  });
}

function extractTopCandidates(predicted: OcrEvalExpected, audit: OcrSuggestAudit | null): OcrEvalTopCandidates {
  const out: OcrEvalTopCandidates = {};
  const taxonomyConstraints = toRecord(audit?.taxonomyConstraints);
  const pool = toRecord(taxonomyConstraints?.pool);

  const setCandidates = toLabelList(pool?.setOptions);
  const insertCandidates = toLabelList(pool?.insertOptions);
  const parallelPoolCandidates = toLabelList(pool?.parallelOptions);
  const variantMatch = toRecord(audit?.variantMatch);
  const variantCandidates = Array.isArray(variantMatch?.candidates)
    ? (variantMatch?.candidates as Array<Record<string, unknown>>)
        .map((entry) => (typeof entry.parallelId === "string" ? entry.parallelId.trim() : ""))
        .filter(Boolean)
    : [];

  const setTop: string[] = [];
  if (predicted.setName) {
    setTop.push(predicted.setName);
  }
  appendUnique(setTop, setCandidates);

  const insertTop: string[] = [];
  if (predicted.insertSet) {
    insertTop.push(predicted.insertSet);
  }
  appendUnique(insertTop, insertCandidates);

  const parallelTop: string[] = [];
  if (predicted.parallel) {
    parallelTop.push(predicted.parallel);
  }
  appendUnique(parallelTop, variantCandidates);
  appendUnique(parallelTop, parallelPoolCandidates);

  if (setTop.length > 0) {
    out.setName = setTop.slice(0, 12);
  }
  if (insertTop.length > 0) {
    out.insertSet = insertTop.slice(0, 12);
  }
  if (parallelTop.length > 0) {
    out.parallel = parallelTop.slice(0, 12);
  }
  return out;
}

function extractCaseMeta(audit: OcrSuggestAudit | null): OcrEvalCaseMeta {
  const memory = toRecord(audit?.memory);
  const applied = memory?.applied;
  const memoryApplied = Array.isArray(applied) && applied.length > 0;
  return { memoryApplied };
}

function buildBaseUrl(req: NextApiRequest): string {
  const host = String(req.headers.host || "").trim();
  if (!host) {
    throw new Error("Missing host header");
  }
  const protocol = readHeaderFirst(req.headers["x-forwarded-proto"]) || "https";
  return `${protocol}://${host}`;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<RunEvalResponse>) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ message: "Method not allowed" });
  }

  let runId: string | null = null;
  try {
    const cronSecret = (process.env.AI_EVAL_CRON_SECRET ?? "").trim();
    const incomingCronSecret = readHeaderFirst(req.headers["x-ai-eval-cron-secret"]);
    const isCron = isSecretMatch(incomingCronSecret, cronSecret);
    if (!isCron) {
      await requireAdminSession(req);
    }

    const triggerRaw =
      typeof req.body?.trigger === "string" && req.body.trigger.trim()
        ? req.body.trigger.trim().toLowerCase()
        : isCron
        ? "scheduled"
        : "manual";
    const trigger = ["manual", "scheduled", "predeploy"].includes(triggerRaw) ? triggerRaw : "manual";

    const evalCases = await listEnabledOcrEvalCases();
    if (evalCases.length < 1) {
      return res.status(400).json({ message: "No enabled eval cases found. Add eval cases first." });
    }

    const run = await (prisma as any).ocrEvalRun.create({
      data: {
        status: "RUNNING",
        trigger,
        startedAt: new Date(),
      },
      select: { id: true },
    });
    const createdRunId = String(run.id);
    runId = createdRunId;

    const baseUrl = buildBaseUrl(req);
    const evalSecret = (process.env.AI_EVAL_RUN_SECRET ?? "").trim();
    const cookieHeader = readHeaderFirst(req.headers.cookie);
    const predictionsByCaseId: Record<string, OcrEvalExpected> = {};
    const topCandidatesByCaseId: Record<string, OcrEvalTopCandidates> = {};
    const metaByCaseId: Record<string, OcrEvalCaseMeta> = {};
    const rawByCaseId: Record<string, { expected: OcrEvalExpected; predicted: OcrEvalExpected; audit: unknown }> = {};

    for (const evalCase of evalCases) {
      const params = new URLSearchParams();
      if (evalCase.hints.year) params.set("year", evalCase.hints.year);
      if (evalCase.hints.manufacturer) params.set("manufacturer", evalCase.hints.manufacturer);
      if (evalCase.hints.sport) params.set("sport", evalCase.hints.sport);
      if (evalCase.hints.productLine) params.set("productLine", evalCase.hints.productLine);
      if (evalCase.hints.setId) params.set("setId", evalCase.hints.setId);
      if (evalCase.hints.layoutClass) params.set("layoutClass", evalCase.hints.layoutClass);
      const query = params.toString();
      const url = `${baseUrl}/api/admin/cards/${encodeURIComponent(evalCase.cardAssetId)}/ocr-suggest${
        query ? `?${query}` : ""
      }`;
      let predicted: OcrEvalExpected = {};
      let audit: OcrSuggestAudit | null = null;
      try {
        const response = await fetch(url, {
          method: "GET",
          headers: {
            ...(cookieHeader ? { cookie: cookieHeader } : {}),
            ...(evalSecret ? { "x-ai-eval-secret": evalSecret } : {}),
          },
        });
        if (response.ok) {
          const payload = (await response.json().catch(() => null)) as
            | {
                suggestions?: Record<string, string>;
                audit?: { fields?: Record<string, string | null> };
              }
            | null;
          const fields = payload?.audit?.fields ?? {};
          predicted = {
            setName: typeof fields.setName === "string" ? fields.setName : null,
            insertSet: typeof fields.insertSet === "string" ? fields.insertSet : null,
            parallel: typeof fields.parallel === "string" ? fields.parallel : null,
          };
          audit = toRecord(payload?.audit);
        }
      } catch {
        predicted = {};
      }
      predictionsByCaseId[evalCase.id] = predicted;
      topCandidatesByCaseId[evalCase.id] = extractTopCandidates(predicted, audit);
      metaByCaseId[evalCase.id] = extractCaseMeta(audit);
      rawByCaseId[evalCase.id] = {
        expected: evalCase.expected,
        predicted,
        audit,
      };
    }

    const evaluated = evaluateOcrEvalCases({
      cases: evalCases,
      predictionsByCaseId,
      topCandidatesByCaseId,
      metaByCaseId,
    });

    const resultRows = evaluated.results.map((entry) => ({
      runId: createdRunId,
      caseId: entry.caseId,
      cardAssetId: entry.cardAssetId,
      passed: entry.passed,
      fieldScoresJson: entry.fieldScores as Prisma.InputJsonValue,
      expectedJson: rawByCaseId[entry.caseId]?.expected as Prisma.InputJsonValue,
      predictedJson: rawByCaseId[entry.caseId]?.predicted as Prisma.InputJsonValue,
      auditJson: rawByCaseId[entry.caseId]?.audit as Prisma.InputJsonValue,
    }));
    if (resultRows.length > 0) {
      await (prisma as any).ocrEvalResult.createMany({ data: resultRows });
    }

    await (prisma as any).ocrEvalRun.update({
      where: { id: createdRunId },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        summaryJson: evaluated.summary as Prisma.InputJsonValue,
        totalsJson: {
          totalCases: evaluated.summary.totalCases,
          passedCases: evaluated.summary.passedCases,
          failedCases: evaluated.summary.failedCases,
        } as Prisma.InputJsonValue,
        thresholdsJson: evaluated.summary.gate.thresholds as Prisma.InputJsonValue,
      },
    });

    return res.status(200).json({
      runId: createdRunId,
      status: "COMPLETED",
      caseCount: evaluated.summary.totalCases,
      summary: evaluated.summary,
      failedCases: evaluated.results
        .filter((entry) => !entry.passed)
        .slice(0, 40)
        .map((entry) => ({
          slug: entry.slug,
          title: entry.title,
          cardAssetId: entry.cardAssetId,
          notes: entry.notes,
        })),
    });
  } catch (error) {
    if (runId) {
      try {
        await (prisma as any).ocrEvalRun.update({
          where: { id: runId },
          data: {
            status: "FAILED",
            completedAt: new Date(),
            summaryJson: {
              error: error instanceof Error ? error.message : "run_failed",
            } as Prisma.InputJsonValue,
          },
        });
      } catch {
        // no-op; preserve original error response
      }
    }
    const response = toErrorResponse(error);
    return res.status(response.status).json({ message: response.message });
  }
}
