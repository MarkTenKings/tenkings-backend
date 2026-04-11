import crypto from "node:crypto";
import type { NextApiRequest } from "next";
import { prisma } from "@tenkings/database";
import { ConversationChannel, ConversationStatus, Prisma } from "@prisma/client";
import { normalizeSupportPhone } from "./support";

type JsonRecord = Record<string, unknown>;

export class ElevenLabsWebhookError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

const elevenLabsApiKey = process.env.ELEVENLABS_API_KEY?.trim() ?? "";
const elevenLabsAgentId = process.env.ELEVENLABS_AGENT_ID?.trim() ?? "";
const elevenLabsWebhookSecret = process.env.ELEVENLABS_WEBHOOK_SECRET?.trim() ?? "";
const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL?.trim() ?? "";

const MAX_SIGNATURE_AGE_MS = 30 * 60 * 1000;

function getSingleHeader(req: NextApiRequest, name: string): string | null {
  const value = req.headers[name.toLowerCase()];
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (Array.isArray(value)) {
    const first = value.find((entry) => typeof entry === "string" && entry.trim().length > 0);
    return first?.trim() ?? null;
  }
  return null;
}

export async function readRawRequestBody(req: NextApiRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req
      .on("data", (chunk) => {
        data += chunk;
      })
      .on("end", () => resolve(data))
      .on("error", (error) => reject(error));
  });
}

function parseFormBody(rawBody: string) {
  const params = new URLSearchParams(rawBody);
  const payload: JsonRecord = {};
  for (const [key, value] of params.entries()) {
    payload[key] = value;
  }
  return payload;
}

export function parseWebhookBody(rawBody: string, contentType: string | null | undefined) {
  if (!rawBody.trim()) {
    return {} as JsonRecord;
  }

  if (contentType?.includes("application/x-www-form-urlencoded")) {
    return parseFormBody(rawBody);
  }

  try {
    return JSON.parse(rawBody) as JsonRecord;
  } catch (error) {
    if (contentType?.includes("application/json")) {
      throw new ElevenLabsWebhookError(400, "Invalid JSON payload");
    }
    return parseFormBody(rawBody);
  }
}

function timingSafeEqual(candidate: string, expected: string) {
  const candidateBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);
  if (candidateBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(candidateBuffer, expectedBuffer);
}

function verifyHeaderSecret(req: NextApiRequest) {
  const authorization = getSingleHeader(req, "authorization");
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    const token = authorization.slice("bearer ".length).trim();
    if (token && elevenLabsApiKey && timingSafeEqual(token, elevenLabsApiKey)) {
      return "api_key" as const;
    }
    if (token && elevenLabsWebhookSecret && timingSafeEqual(token, elevenLabsWebhookSecret)) {
      return "webhook_secret" as const;
    }
  }

  const headerCandidates = [
    getSingleHeader(req, "xi-api-key"),
    getSingleHeader(req, "x-api-key"),
    getSingleHeader(req, "x-elevenlabs-api-key"),
    getSingleHeader(req, "x-webhook-secret"),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of headerCandidates) {
    if (elevenLabsApiKey && timingSafeEqual(candidate, elevenLabsApiKey)) {
      return "api_key" as const;
    }
    if (elevenLabsWebhookSecret && timingSafeEqual(candidate, elevenLabsWebhookSecret)) {
      return "webhook_secret" as const;
    }
  }

  return null;
}

function buildSignatureDigests(secret: string, rawBody: string, timestamp: string | null) {
  const payloadCandidates = timestamp ? [`${timestamp}.${rawBody}`, rawBody] : [rawBody];
  const digests = new Set<string>();

  for (const payload of payloadCandidates) {
    const digest = crypto.createHmac("sha256", secret).update(payload).digest();
    digests.add(digest.toString("hex"));
    digests.add(digest.toString("base64"));
    digests.add(digest.toString("base64url"));
  }

  return digests;
}

function verifySignature(rawBody: string, signatureHeader: string | null) {
  if (!elevenLabsWebhookSecret || !signatureHeader) {
    return false;
  }

  const parts = signatureHeader
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  let timestamp: string | null = null;
  const signatures = new Set<string>();

  if (parts.length > 1 || signatureHeader.includes("=")) {
    for (const part of parts) {
      const separatorIndex = part.indexOf("=");
      if (separatorIndex === -1) {
        signatures.add(part);
        continue;
      }
      const key = part.slice(0, separatorIndex).trim().toLowerCase();
      const value = part.slice(separatorIndex + 1).trim();
      if (!value) {
        continue;
      }
      if (key === "t" || key === "ts" || key === "timestamp") {
        timestamp = value;
        continue;
      }
      if (key.startsWith("v") || key === "sig" || key === "signature" || key === "hmac") {
        signatures.add(value);
      }
    }
  } else {
    signatures.add(signatureHeader.trim());
  }

  if (!signatures.size) {
    return false;
  }

  if (timestamp) {
    const parsedTimestamp = Number(timestamp);
    if (Number.isFinite(parsedTimestamp)) {
      const timestampMs = parsedTimestamp > 1_000_000_000_000 ? parsedTimestamp : parsedTimestamp * 1000;
      if (Math.abs(Date.now() - timestampMs) > MAX_SIGNATURE_AGE_MS) {
        return false;
      }
    }
  }

  const digests = buildSignatureDigests(elevenLabsWebhookSecret, rawBody, timestamp);
  for (const signature of signatures) {
    for (const digest of digests) {
      if (timingSafeEqual(signature, digest)) {
        return true;
      }
    }
  }

  return false;
}

function readNestedValue(payload: unknown, path: string[]) {
  let current: unknown = payload;
  for (const segment of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return null;
    }
    current = (current as JsonRecord)[segment];
  }
  return current ?? null;
}

function findFirstString(payload: unknown, paths: string[][]) {
  for (const path of paths) {
    const value = readNestedValue(payload, path);
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function flattenNoteValue(value: unknown): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => flattenNoteValue(entry));
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as JsonRecord).flatMap(([key, entry]) => {
      const nested = flattenNoteValue(entry);
      if (!nested.length) {
        return [];
      }
      return nested.map((item) => `${key}: ${item}`);
    });
    return entries;
  }
  return [];
}

function formatConversationDate(value: Date | null | undefined) {
  if (!value) {
    return null;
  }
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(value);
}

function formatHistorySummary(summary: string | null | undefined, channel: ConversationChannel, status: ConversationStatus) {
  if (summary && summary.trim()) {
    return summary.trim();
  }
  return `${channel.toLowerCase()} conversation ${status.toLowerCase()}`;
}

function buildCustomerHistory(customer: {
  conversations: Array<{
    startedAt: Date;
    endedAt: Date | null;
    summary: string | null;
    channel: ConversationChannel;
    status: ConversationStatus;
  }>;
}) {
  const entries = customer.conversations
    .map((conversation) => {
      const dateLabel = formatConversationDate(conversation.endedAt ?? conversation.startedAt);
      const summary = formatHistorySummary(conversation.summary, conversation.channel, conversation.status);
      return dateLabel ? `${dateLabel}: ${summary}` : summary;
    })
    .filter(Boolean);

  return entries.join(" | ");
}

function buildCustomerNotes(customer: {
  notes: Prisma.JsonValue | null;
  customerNotes: Array<{ note: string }>;
}) {
  const values = [
    ...flattenNoteValue(customer.notes),
    ...customer.customerNotes.map((note) => note.note.trim()).filter(Boolean),
  ];
  return Array.from(new Set(values)).join(" | ");
}

function toConversationChannelLabel(channel: ConversationChannel) {
  switch (channel) {
    case ConversationChannel.PHONE:
    case ConversationChannel.VOICE:
      return "phone";
    case ConversationChannel.SMS:
      return "sms";
    case ConversationChannel.CHAT:
      return "chat";
    case ConversationChannel.EMAIL:
      return "email";
    default:
      return "chat";
  }
}

function normalizeChannel(value: string | null) {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized.includes("sms") || normalized.includes("text") || normalized.includes("whatsapp")) {
    return ConversationChannel.SMS;
  }
  if (normalized.includes("chat") || normalized.includes("web")) {
    return ConversationChannel.CHAT;
  }
  if (normalized.includes("email")) {
    return ConversationChannel.EMAIL;
  }
  if (normalized.includes("voice") || normalized.includes("phone") || normalized.includes("call") || normalized.includes("twilio") || normalized.includes("sip")) {
    return ConversationChannel.PHONE;
  }
  return null;
}

export function extractElevenLabsAgentId(payload: unknown) {
  return findFirstString(payload, [
    ["agent_id"],
    ["agentId"],
    ["data", "agent_id"],
    ["data", "agentId"],
  ]);
}

function extractWebhookChannel(payload: unknown) {
  const explicit = normalizeChannel(
    findFirstString(payload, [
      ["channel"],
      ["conversation_channel"],
      ["source_channel"],
      ["data", "channel"],
      ["metadata", "type"],
    ])
  );

  if (explicit) {
    return explicit;
  }

  const phoneHints = [
    findFirstString(payload, [["caller_id"], ["called_number"], ["call_sid"], ["data", "caller_id"]]),
    findFirstString(payload, [["metadata", "body", "CallSid"], ["metadata", "body", "call_sid"]]),
  ].filter(Boolean);

  if (phoneHints.length > 0) {
    return ConversationChannel.PHONE;
  }

  return ConversationChannel.CHAT;
}

export function extractElevenLabsPhone(payload: unknown) {
  const rawPhone = findFirstString(payload, [
    ["caller_id"],
    ["callerId"],
    ["phone"],
    ["phone_number"],
    ["customer_phone"],
    ["from_number"],
    ["from"],
    ["data", "caller_id"],
    ["data", "callerId"],
    ["data", "phone"],
    ["data", "phone_number"],
    ["metadata", "body", "From"],
    ["metadata", "body", "Caller"],
    ["metadata", "body", "from_number"],
    ["metadata", "body", "from"],
  ]);

  return normalizeSupportPhone(rawPhone);
}

export function extractInternalConversationId(payload: unknown) {
  return findFirstString(payload, [
    ["data", "conversation_initiation_client_data", "dynamic_variables", "conversation_id"],
    ["data", "conversation_initiation_client_data", "dynamic_variables", "support_conversation_id"],
    ["data", "dynamic_variables", "conversation_id"],
    ["data", "dynamic_variables", "support_conversation_id"],
    ["conversation_initiation_client_data", "dynamic_variables", "conversation_id"],
    ["conversation_initiation_client_data", "dynamic_variables", "support_conversation_id"],
    ["dynamic_variables", "conversation_id"],
    ["dynamic_variables", "support_conversation_id"],
    ["conversation_id"],
  ]);
}

function extractExternalConversationId(payload: unknown) {
  return findFirstString(payload, [
    ["data", "conversation_id"],
    ["conversation_id"],
  ]);
}

function normalizeOutcome(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const normalized = value.trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (["ESCALATED", "ESCALATE", "HUMAN_HANDOFF", "NEEDS_HUMAN"].includes(normalized)) {
    return "ESCALATED" as const;
  }
  if (["RESOLVED", "SUCCESS", "DONE", "COMPLETE", "COMPLETED"].includes(normalized)) {
    return "RESOLVED" as const;
  }
  if (["FAIL", "FAILED", "FAILURE", "UNSUCCESSFUL"].includes(normalized)) {
    return "ESCALATED" as const;
  }
  return null;
}

function formatTranscriptTimestamp(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) {
    return null;
  }
  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, "0");
  const remainder = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

export function formatTranscript(value: unknown) {
  if (typeof value === "string") {
    return value.trim();
  }
  if (!Array.isArray(value)) {
    return "";
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return null;
      }
      const turn = entry as JsonRecord;
      const roleValue = typeof turn.role === "string" ? turn.role.trim().toUpperCase() : "UNKNOWN";
      const messageValue =
        typeof turn.message === "string"
          ? turn.message.trim()
          : typeof turn.content === "string"
            ? turn.content.trim()
            : "";
      if (!messageValue) {
        return null;
      }
      const timestampValue =
        typeof turn.time_in_call_secs === "number"
          ? turn.time_in_call_secs
          : typeof turn.timeInCallSecs === "number"
            ? turn.timeInCallSecs
            : null;
      const timestamp = formatTranscriptTimestamp(timestampValue);
      return timestamp ? `[${timestamp}] ${roleValue}: ${messageValue}` : `${roleValue}: ${messageValue}`;
    })
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

export function parseConversationEndPayload(payload: unknown) {
  const summary =
    findFirstString(payload, [
      ["summary"],
      ["data", "summary"],
      ["data", "analysis", "transcript_summary"],
      ["data", "analysis", "summary"],
    ]) ?? "";

  const transcriptValue =
    readNestedValue(payload, ["data", "transcript"]) ??
    readNestedValue(payload, ["transcript"]) ??
    null;

  const durationValue =
    readNestedValue(payload, ["data", "metadata", "call_duration_secs"]) ??
    readNestedValue(payload, ["metadata", "call_duration_secs"]) ??
    readNestedValue(payload, ["duration"]) ??
    readNestedValue(payload, ["data", "duration"]) ??
    null;

  const outcome =
    normalizeOutcome(readNestedValue(payload, ["outcome"])) ??
    normalizeOutcome(readNestedValue(payload, ["data", "outcome"])) ??
    normalizeOutcome(readNestedValue(payload, ["data", "analysis", "outcome"])) ??
    normalizeOutcome(readNestedValue(payload, ["data", "analysis", "call_successful"])) ??
    normalizeOutcome(readNestedValue(payload, ["data", "conversation_initiation_client_data", "dynamic_variables", "outcome"])) ??
    "RESOLVED";

  return {
    internalConversationId: extractInternalConversationId(payload),
    externalConversationId: extractExternalConversationId(payload),
    transcript: formatTranscript(transcriptValue),
    summary,
    duration:
      typeof durationValue === "number"
        ? durationValue
        : typeof durationValue === "string" && durationValue.trim()
          ? Number(durationValue)
          : null,
    outcome,
  };
}

export async function verifyAndParseElevenLabsWebhook(req: NextApiRequest) {
  const rawBody = await readRawRequestBody(req);
  const signatureHeader = getSingleHeader(req, "elevenlabs-signature");

  const signatureVerified = verifySignature(rawBody, signatureHeader);
  const headerSecretMode = verifyHeaderSecret(req);
  const authMode = signatureVerified ? "signature" : headerSecretMode;

  if (!authMode) {
    throw new ElevenLabsWebhookError(401, "Invalid ElevenLabs webhook credentials");
  }

  const payload = parseWebhookBody(rawBody, getSingleHeader(req, "content-type"));
  const payloadAgentId = extractElevenLabsAgentId(payload);

  if (elevenLabsAgentId && payloadAgentId && payloadAgentId !== elevenLabsAgentId) {
    throw new ElevenLabsWebhookError(401, "Webhook agent id does not match configured ElevenLabs agent");
  }

  return {
    rawBody,
    payload,
    authMode,
  };
}

export async function findSupportCustomerForPhone(phone: string) {
  return prisma.supportCustomer.findUnique({
    where: { phone },
    include: {
      conversations: {
        orderBy: { startedAt: "desc" },
        take: 3,
        select: {
          id: true,
          channel: true,
          status: true,
          startedAt: true,
          endedAt: true,
          summary: true,
        },
      },
      customerNotes: {
        orderBy: { createdAt: "desc" },
        take: 3,
        select: {
          note: true,
        },
      },
    },
  });
}

export async function findOrCreateSupportCustomer(phone: string) {
  const existing = await findSupportCustomerForPhone(phone);
  if (existing) {
    return { customer: existing, created: false };
  }

  try {
    const created = await prisma.supportCustomer.create({
      data: { phone },
    });

    const hydrated = await findSupportCustomerForPhone(created.phone ?? phone);
    if (!hydrated) {
      throw new ElevenLabsWebhookError(500, "Failed to load newly created support customer");
    }
    return { customer: hydrated, created: true };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const hydrated = await findSupportCustomerForPhone(phone);
      if (hydrated) {
        return { customer: hydrated, created: false };
      }
    }
    throw error;
  }
}

export async function createSupportConversation(params: {
  customerId: string;
  channel: ConversationChannel;
  agentId?: string | null;
}) {
  const timestamp = new Date();
  const conversation = await prisma.$transaction(async (tx) => {
    const created = await tx.conversation.create({
      data: {
        customerId: params.customerId,
        channel: params.channel,
        agentId: params.agentId ?? null,
      },
      select: { id: true },
    });

    await tx.supportCustomer.update({
      where: { id: params.customerId },
      data: { lastSeen: timestamp },
    });

    return created;
  });

  return conversation;
}

export async function updateSupportConversation(params: {
  conversationId: string;
  status: ConversationStatus;
  summary?: string | null;
  transcript?: string | null;
}) {
  const timestamp = new Date();
  const data: Prisma.ConversationUncheckedUpdateInput = {
    status: params.status,
    endedAt:
      params.status === ConversationStatus.OPEN
        ? null
        : timestamp,
  };

  if (params.summary !== undefined) {
    data.summary = params.summary ?? null;
  }

  if (params.transcript !== undefined) {
    data.transcript = params.transcript ?? null;
  }

  const conversation = await prisma.$transaction(async (tx) => {
    const updated = await tx.conversation.update({
      where: { id: params.conversationId },
      data,
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
          },
        },
      },
    });

    await tx.supportCustomer.update({
      where: { id: updated.customerId },
      data: { lastSeen: timestamp },
    });

    return updated;
  });

  return conversation;
}

export async function createSupportEscalation(conversationId: string) {
  const existing = await prisma.escalation.findUnique({
    where: { conversationId },
  });

  if (existing) {
    return existing;
  }

  return prisma.$transaction(async (tx) => {
    const escalation = await tx.escalation.create({
      data: { conversationId },
    });

    await tx.conversation.update({
      where: { id: conversationId },
      data: { status: ConversationStatus.ESCALATED, endedAt: new Date() },
    });

    return escalation;
  });
}

export function buildConversationStartResponse(params: {
  customer: {
    name: string | null;
    notes: Prisma.JsonValue | null;
    conversations: Array<{
      startedAt: Date;
      endedAt: Date | null;
      summary: string | null;
      channel: ConversationChannel;
      status: ConversationStatus;
    }>;
    customerNotes: Array<{ note: string }>;
  };
  isReturningCustomer: boolean;
  conversationId: string;
}) {
  return {
    type: "conversation_initiation_client_data",
    dynamic_variables: {
      customer_name: params.isReturningCustomer ? params.customer.name?.trim() ?? "" : "",
      customer_history: params.isReturningCustomer ? buildCustomerHistory(params.customer) : "",
      customer_notes: params.isReturningCustomer ? buildCustomerNotes(params.customer) : "",
      is_returning_customer: params.isReturningCustomer ? "true" : "false",
      conversation_id: params.conversationId,
    },
  };
}

export function buildSafeConversationStartResponse() {
  return {
    type: "conversation_initiation_client_data",
    dynamic_variables: {
      customer_name: "",
      customer_history: "",
      customer_notes: "",
      is_returning_customer: "false",
      conversation_id: "",
    },
  };
}

export async function sendSlackConversationSummary(params: {
  customerName: string;
  customerPhone: string | null;
  channel: ConversationChannel;
  summary: string;
  outcome: "RESOLVED" | "ESCALATED";
  duration: number | null;
}) {
  if (!slackWebhookUrl) {
    return { delivered: false, skipped: true } as const;
  }

  const lines = [
    "*Queen Conversation Summary*",
    `Customer: ${params.customerName}${params.customerPhone ? ` (${params.customerPhone})` : ""}`,
    `Channel: ${toConversationChannelLabel(params.channel)}`,
    `Outcome: ${params.outcome}`,
    `Summary: ${params.summary || "No summary provided"}`,
  ];

  if (typeof params.duration === "number" && Number.isFinite(params.duration)) {
    lines.push(`Duration: ${params.duration}s`);
  }

  const response = await fetch(slackWebhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: lines.join("\n"),
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "Slack webhook error");
    throw new Error(`Slack webhook failed (${response.status}): ${text}`);
  }

  return { delivered: true, skipped: false } as const;
}

export function resolveConversationStartContext(payload: unknown) {
  const phone = extractElevenLabsPhone(payload);
  if (!phone) {
    throw new ElevenLabsWebhookError(400, "Caller phone number is required");
  }

  return {
    phone,
    channel: extractWebhookChannel(payload),
    agentId: extractElevenLabsAgentId(payload) ?? elevenLabsAgentId ?? null,
  };
}
