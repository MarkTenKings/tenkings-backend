import type { NextApiRequest, NextApiResponse } from "next";
import {
  buildConversationStartResponse,
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
    return res.status(405).json({ message: "Method not allowed" });
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
      return res.status(error.statusCode).json({ message: error.message });
    }
    if (error instanceof Error) {
      console.error("[support][elevenlabs][conversation-start] unexpected error", error);
      return res.status(500).json({ message: error.message });
    }
    return res.status(500).json({ message: "Unexpected error" });
  }
}
