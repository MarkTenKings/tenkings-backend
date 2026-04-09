import { prisma } from "@tenkings/database";
import {
  ConversationChannel,
  ConversationStatus,
  MessageRole,
  NoteSource,
  Prisma,
  Sentiment,
} from "@prisma/client";
import { z } from "zod";

const normalizedStringField = () =>
  z.preprocess((value) => {
    if (typeof value !== "string") {
      return value;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }, z.string().min(1).nullable());

const jsonValueSchema: z.ZodTypeAny = z.lazy(() =>
  z.union([z.string(), z.number().finite(), z.boolean(), z.null(), z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema)])
);

export const supportCustomerLookupSchema = z.object({
  phone: z.preprocess(
    (value) => (Array.isArray(value) ? value[0] : value),
    z.string().min(1, "phone is required")
  ),
});

export const supportCustomerUpsertSchema = z
  .object({
    phone: normalizedStringField().optional(),
    email: z.preprocess((value) => {
      if (typeof value !== "string") {
        return value;
      }
      const normalized = value.trim().toLowerCase();
      return normalized.length > 0 ? normalized : null;
    }, z.string().email("email must be valid").nullable()).optional(),
    name: normalizedStringField().optional(),
    preferredLang: normalizedStringField().optional(),
    notes: jsonValueSchema.optional(),
    linkedUserId: normalizedStringField().optional(),
  })
  .refine((value) => value.phone !== undefined || value.email !== undefined, {
    message: "phone or email is required",
  });

export const supportConversationCreateSchema = z.object({
  customerId: z.string().trim().min(1, "customerId is required"),
  channel: z.nativeEnum(ConversationChannel),
  summary: normalizedStringField().optional(),
  transcript: normalizedStringField().optional(),
  agentId: normalizedStringField().optional(),
  locationId: normalizedStringField().optional(),
});

export const supportMessageCreateSchema = z.object({
  role: z.nativeEnum(MessageRole),
  content: z.string().trim().min(1, "content is required"),
  sentiment: z.nativeEnum(Sentiment).nullable().optional(),
});

export const supportConversationUpdateSchema = z
  .object({
    status: z.nativeEnum(ConversationStatus).optional(),
    summary: normalizedStringField().optional(),
  })
  .refine((value) => value.status !== undefined || value.summary !== undefined, {
    message: "status or summary is required",
  });

export const supportEscalationCreateSchema = z.object({
  conversationId: z.string().trim().min(1, "conversationId is required"),
  assignedTo: normalizedStringField().optional(),
});

export const supportCustomerNoteCreateSchema = z.object({
  note: z.string().trim().min(1, "note is required"),
  source: z.nativeEnum(NoteSource).optional(),
});

export const normalizeSupportPhone = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }
  const digits = value.replace(/[^0-9]/g, "");
  if (!digits) {
    return null;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  return `+${digits}`;
};

export const normalizeSupportEmail = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
};

export async function findSupportCustomerIdentityMatches(params: {
  phone?: string | null;
  email?: string | null;
}) {
  const orClauses: Prisma.SupportCustomerWhereInput[] = [];

  if (params.phone) {
    orClauses.push({ phone: params.phone });
  }

  if (params.email) {
    orClauses.push({ email: params.email });
  }

  if (orClauses.length === 0) {
    return [];
  }

  return prisma.supportCustomer.findMany({
    where: { OR: orClauses },
    orderBy: { createdAt: "asc" },
  });
}

export const toNullableJsonInput = (
  value: unknown
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return Prisma.JsonNull;
  }
  return value as Prisma.InputJsonValue;
};

export const appendConversationTranscript = (
  existingTranscript: string | null | undefined,
  role: MessageRole,
  content: string,
  timestamp: Date
) => {
  const line = `${timestamp.toISOString()} [${role}] ${content.trim()}`;
  if (!existingTranscript || existingTranscript.trim().length === 0) {
    return line;
  }
  return `${existingTranscript}\n${line}`;
};
