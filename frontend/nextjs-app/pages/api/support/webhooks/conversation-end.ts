import type { NextApiRequest, NextApiResponse } from "next";
import { ConversationStatus, Prisma } from "@prisma/client";
import {
  createSupportEscalation,
  parseConversationEndPayload,
  sendSlackConversationSummary,
  updateSupportConversation,
  verifyAndParseElevenLabsWebhook,
  ElevenLabsWebhookError,
} from "../../../../lib/server/elevenlabs";

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(200).json({ ok: true, ignored: true });
  }

  try {
    const { payload, authMode } = await verifyAndParseElevenLabsWebhook(req);
    const parsed = parseConversationEndPayload(payload);

    if (!parsed.internalConversationId) {
      console.warn("[support][elevenlabs][conversation-end] accepted without internal conversation id", {
        externalConversationId: parsed.externalConversationId,
      });
      return res.status(200).json({
        ok: true,
        accepted: true,
        skipped: true,
        reason: "missing_internal_conversation_id",
        externalConversationId: parsed.externalConversationId,
        outcome: parsed.outcome,
      });
    }

    const status =
      parsed.outcome === "ESCALATED"
        ? ConversationStatus.ESCALATED
        : ConversationStatus.RESOLVED;

    const conversation = await updateSupportConversation({
      conversationId: parsed.internalConversationId,
      status,
      summary: parsed.summary,
      transcript: parsed.transcript,
    });

    let escalationId: string | null = null;
    if (parsed.outcome === "ESCALATED") {
      const escalation = await createSupportEscalation(parsed.internalConversationId);
      escalationId = escalation.id;
    }

    try {
      await sendSlackConversationSummary({
        customerName: conversation.customer.name ?? "Unknown customer",
        customerPhone: conversation.customer.phone,
        channel: conversation.channel,
        summary: parsed.summary,
        outcome: parsed.outcome,
        duration: parsed.duration,
      });
    } catch (error) {
      console.warn("[support][elevenlabs][conversation-end] slack notification failed", error);
    }

    console.info("[support][elevenlabs][conversation-end]", {
      authMode,
      internalConversationId: parsed.internalConversationId,
      externalConversationId: parsed.externalConversationId,
      outcome: parsed.outcome,
      escalationId,
    });

    return res.status(200).json({
      ok: true,
      accepted: true,
      conversationId: parsed.internalConversationId,
      externalConversationId: parsed.externalConversationId,
      outcome: parsed.outcome,
      escalationId,
    });
  } catch (error) {
    if (error instanceof ElevenLabsWebhookError) {
      console.warn("[support][elevenlabs][conversation-end] accepted after webhook error", {
        statusCode: error.statusCode,
        message: error.message,
      });
      return res.status(200).json({
        ok: true,
        accepted: true,
        skipped: true,
        reason: "webhook_error",
      });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      console.warn("[support][elevenlabs][conversation-end] accepted after missing conversation", error);
      return res.status(200).json({
        ok: true,
        accepted: true,
        skipped: true,
        reason: "conversation_not_found",
      });
    }
    if (error instanceof Error) {
      console.error("[support][elevenlabs][conversation-end] unexpected error", error);
      return res.status(200).json({
        ok: true,
        accepted: true,
        skipped: true,
        reason: "unexpected_error",
      });
    }
    console.error("[support][elevenlabs][conversation-end] unexpected non-error rejection", error);
    return res.status(200).json({
      ok: true,
      accepted: true,
      skipped: true,
      reason: "unexpected_error",
    });
  }
}
