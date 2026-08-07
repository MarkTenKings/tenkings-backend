import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";

import { requireAdminSession } from "../../../../../lib/server/admin";
import { HttpError } from "../../../../../lib/server/adminSessionAuthority";
import {
  CompsV2HttpError,
  confirmCompsV2,
  getCompsV2Card,
  listCompsV2Cards,
  publicCardState,
  runCompsV2Search,
  setCompsV2Public,
} from "../../../../../lib/server/compsV2";
import { presignReadUrl } from "../../../../../lib/server/storage";

export const config = { api: { bodyParser: { sizeLimit: "320kb" } } };

const revision = z.string().regex(/^[a-f0-9]{64}$/);
const identity = z.object({
  category: z.enum(["SPORTS", "POKEMON"]),
  playerName: z.string().trim().min(1).max(200).nullable().optional(),
  cardName: z.string().trim().min(1).max(200).nullable().optional(),
  year: z.string().trim().min(1).max(40),
  manufacturer: z.string().trim().min(1).max(120).nullable().optional(),
  productSet: z.string().trim().min(1).max(200),
  parallel: z.string().trim().min(1).max(160).nullable().optional(),
  insert: z.string().trim().min(1).max(160).nullable().optional(),
  cardNumber: z.string().trim().min(1).max(80).nullable().optional(),
  targetGrade: z.number().min(1).max(10).nullable().optional(),
  offset: z.number().int().min(0).max(100000).optional(),
}).strict();
const searchBody = z.object({
  cardId: z.string().trim().min(1).max(64).optional(),
  researchIdentity: identity.optional(),
  query: z.string().trim().min(1).max(400),
  operation: z.enum(["FIND", "FETCH_MORE", "REFRESH"]),
  expectedCompsStateRevision: revision.optional(),
  acknowledgeReplaceSelected: z.boolean().optional(),
  reviewProof: z.unknown().optional(),
}).strict().refine((value) => Boolean(value.cardId) !== Boolean(value.researchIdentity), {
  message: "Choose card mode or research mode",
});
const confirmBody = z.object({
  cardId: z.string().trim().min(1).max(64),
  expectedCompsStateRevision: revision,
  selectedCandidateIds: z.array(z.string().trim().min(1).max(100)).min(1).max(60),
  marketValueCents: z.number().int().positive().safe(),
  compsPublic: z.boolean(),
  reviewProof: z.unknown().optional(),
}).strict();
const publicBody = z.object({
  cardId: z.string().trim().min(1).max(64),
  expectedCompsStateRevision: revision,
  compsPublic: z.boolean(),
}).strict();

const actionFrom = (req: NextApiRequest) => {
  const action = req.query.action;
  return Array.isArray(action) && action.length === 1 ? action[0] : null;
};

const cardPayload = async (card: NonNullable<Awaited<ReturnType<typeof getCompsV2Card>>>) => {
  const state = publicCardState(card);
  return {
    ...state,
    imageUrl: state.imageStorageKey ? await presignReadUrl(state.imageStorageKey, 60 * 60) : null,
    imageStorageKey: undefined,
  };
};

export function createCompsV2ApiHandler() {
  return async function handler(req: NextApiRequest, res: NextApiResponse) {
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    try {
      const admin = await requireAdminSession(req);
      const action = actionFrom(req);
      if (action === "cards" && req.method === "GET") {
        const query = typeof req.query.q === "string" ? req.query.q : "";
        const cards = await listCompsV2Cards(query);
        return res.status(200).json({
          cards: cards.map((card) => {
            const state = publicCardState(card);
            return {
              id: state.id,
              publicToken: state.publicToken,
              certificateNumber: state.certificateNumber,
              category: state.category,
              name: state.category === "SPORTS" ? state.playerName : state.cardName,
              details: [state.year, state.manufacturer, state.productSet, state.parallel, state.cardNumber].filter(Boolean).join(" · "),
              marketValueCents: state.marketValueCents,
              compsStateRevision: state.compsStateRevision,
            };
          }),
        });
      }
      if (action === "card" && req.method === "GET") {
        const cardId = typeof req.query.card === "string" ? req.query.card : "";
        const card = cardId ? await getCompsV2Card(cardId) : null;
        return card ? res.status(200).json({ card: await cardPayload(card) }) : res.status(404).json({ message: "Ten Kings V2 card not found", code: "CARD_NOT_FOUND" });
      }
      if (action === "search" && req.method === "POST") {
        const parsed = searchBody.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ message: "Invalid comps search request", code: "INVALID_REQUEST" });
        const result = await runCompsV2Search({ ...parsed.data, adminId: admin.user.id });
        if (result.mode === "RESEARCH" || result.mode === "CARD_REVIEW") return res.status(200).json(result);
        const card = await getCompsV2Card(result.card.id);
        return card ? res.status(200).json({ mode: "CARD", card: await cardPayload(card) }) : res.status(404).json({ message: "Ten Kings V2 card not found", code: "CARD_NOT_FOUND" });
      }
      if (action === "confirm" && req.method === "POST") {
        const parsed = confirmBody.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ message: "Invalid confirmation request", code: "INVALID_REQUEST" });
        await confirmCompsV2({ ...parsed.data, adminId: admin.user.id });
        const card = await getCompsV2Card(parsed.data.cardId);
        return card ? res.status(200).json({ card: await cardPayload(card) }) : res.status(404).json({ message: "Ten Kings V2 card not found", code: "CARD_NOT_FOUND" });
      }
      if (action === "public" && req.method === "POST") {
        const parsed = publicBody.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ message: "Invalid public-setting request", code: "INVALID_REQUEST" });
        await setCompsV2Public({ ...parsed.data, adminId: admin.user.id });
        const card = await getCompsV2Card(parsed.data.cardId);
        return card ? res.status(200).json({ card: await cardPayload(card) }) : res.status(404).json({ message: "Ten Kings V2 card not found", code: "CARD_NOT_FOUND" });
      }
      res.setHeader("Allow", action === "cards" || action === "card" ? "GET" : "POST");
      return res.status(action ? 405 : 404).json({ message: action ? "Method not allowed" : "Comps action not found", code: action ? "METHOD_NOT_ALLOWED" : "NOT_FOUND" });
    } catch (error) {
      if (error instanceof HttpError) return res.status(error.statusCode).json({ message: error.message, code: "ADMIN_AUTH_REQUIRED" });
      if (error instanceof CompsV2HttpError) return res.status(error.status).json({ message: error.message, code: error.code });
      const code = error instanceof Error && error.name === "EbaySoldCompsV2Error" ? "COMPS_PROVIDER_UNAVAILABLE" : "COMPS_REQUEST_FAILED";
      console.error("[CompsV2] request_failed", { action: actionFrom(req), code });
      return res.status(code === "COMPS_PROVIDER_UNAVAILABLE" ? 502 : 500).json({
        message: code === "COMPS_PROVIDER_UNAVAILABLE" ? "eBay sold comps are temporarily unavailable. Try again." : "Sold comps request could not be completed.",
        code,
      });
    }
  };
}

export default createCompsV2ApiHandler();
