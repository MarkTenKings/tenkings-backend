import type { NextApiRequest, NextApiResponse } from "next";
import {
  buildConversationStartResponse,
  buildSafeConversationStartResponse,
  createSupportConversation,
  findOrCreateSupportCustomer,
  resolveConversationStartContext,
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
    return res.status(200).json(buildSafeConversationStartResponse());
  }

  try {
    const { payload, authMode } = await verifyAndParseElevenLabsWebhook(req);
    const context = resolveConversationStartContext(payload);
    const { customer, created } = await findOrCreateSupportCustomer(context.phone);
    const conversation = await createSupportConversation({
      customerId: customer.id,
      channel: context.channel,
      agentId: context.agentId,
    });

    console.info("[support][elevenlabs][conversation-start]", {
      authMode,
      phone: context.phone,
      customerId: customer.id,
      conversationId: conversation.id,
      returningCustomer: !created,
    });

    return res.status(200).json(
      buildConversationStartResponse({
        customer,
        isReturningCustomer: !created,
        conversationId: conversation.id,
      })
    );
  } catch (error) {
    if (error instanceof ElevenLabsWebhookError) {
      console.warn("[support][elevenlabs][conversation-start] returning safe fallback", {
        statusCode: error.statusCode,
        message: error.message,
      });
      return res.status(200).json(buildSafeConversationStartResponse());
    }
    if (error instanceof Error) {
      console.error("[support][elevenlabs][conversation-start] unexpected error", error);
      return res.status(200).json(buildSafeConversationStartResponse());
    }
    console.error("[support][elevenlabs][conversation-start] unexpected non-error rejection", error);
    return res.status(200).json(buildSafeConversationStartResponse());
  }
}
