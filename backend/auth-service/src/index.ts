import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import twilio from "twilio";
import { z } from "zod";
import crypto from "node:crypto";
import { prisma, Prisma } from "@tenkings/database";

const app = express();
const port = process.env.PORT ? Number(process.env.PORT) : 8080;
const serviceName = "auth-service";

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const verifyServiceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
const parsedTtl = process.env.SESSION_TTL_HOURS ? Number(process.env.SESSION_TTL_HOURS) : 720;
const sessionTtlHours = Number.isFinite(parsedTtl) && parsedTtl > 0 ? parsedTtl : 720;

const twilioClient = accountSid && authToken ? twilio(accountSid, authToken) : null;

app.use(cors());
app.use(express.json());

const phoneSchema = z
  .string()
  .min(8)
  .transform((value) => value.replace(/[^+\d]/g, ""))
  .refine((value) => value.startsWith("+"), "Phone number must be in E.164 format (start with +)");

const extractBearerToken = (req: Request) => {
  const header = req.headers.authorization ?? "";
  const [scheme, token] = header.trim().split(/\s+/);
  if (!scheme || scheme.toLowerCase() !== "bearer" || !token) {
    return null;
  }
  return token;
};

const fetchActiveSession = async (token: string) => {
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: {
      user: {
        include: {
          wallet: true,
        },
      },
    },
  });
  if (!session || !session.user) {
    return null;
  }
  if (session.expiresAt.getTime() <= Date.now()) {
    return null;
  }
  return session;
};

const resolveWallet = async (userId: string, existing?: { id: string; balance: number } | null) => {
  if (existing) {
    return existing;
  }
  const wallet = await prisma.wallet.findUnique({ where: { userId } });
  return wallet ? { id: wallet.id, balance: wallet.balance } : null;
};

const sendCodeSchema = z.object({
  phone: phoneSchema,
});

app.post(["/auth/send-code", "/send-code"], async (req, res, next) => {
  try {
    if (!twilioClient || !verifyServiceSid) {
      return res.status(503).json({ message: "Twilio verify not configured" });
    }

    const { phone } = sendCodeSchema.parse(req.body);

    console.log(`[auth] send-code request`, { phone });

    await twilioClient.verify.v2.services(verifyServiceSid).verifications.create({
      to: phone,
      channel: "sms",
    });

    await prisma.authVerification.upsert({
      where: { phone },
      update: { status: "sent" },
      create: { phone, status: "sent" },
    });

    res.json({ status: "sent" });
  } catch (error) {
    console.error("auth send-code failed", error);
    next(error);
  }
});

const verifySchema = z.object({
  phone: phoneSchema,
  code: z.string().min(3).max(10),
});

const profileUpdateSchema = z.object({
  displayName: z.string().max(64).optional(),
  avatarUrl: z.union([z.string().max(100_000), z.literal(""), z.null()]).optional(),
});

app.post(["/auth/verify", "/verify"], async (req, res, next) => {
  try {
    if (!twilioClient || !verifyServiceSid) {
      return res.status(503).json({ message: "Twilio verify not configured" });
    }

    const { phone, code } = verifySchema.parse(req.body);

    const result = await twilioClient.verify.v2.services(verifyServiceSid).verificationChecks.create({
      to: phone,
      code,
    });

    if (result.status !== "approved") {
      return res.status(400).json({ message: "Invalid verification code" });
    }

    const sessionToken = crypto.randomUUID().replace(/-/g, "");
    const tokenHash = crypto.createHash("sha256").update(sessionToken).digest("hex");
    const expiresAt = new Date(Date.now() + sessionTtlHours * 60 * 60 * 1000);

    const payload = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const user = await tx.user.upsert({
        where: { phone },
        update: { phoneVerifiedAt: new Date() },
        create: {
          phone,
          phoneVerifiedAt: new Date(),
          email: `${phone.replace(/[^\d]/g, "")}@sms.tenkings.app`,
        },
      });

      await tx.authVerification.upsert({
        where: { phone },
        update: { status: "approved" },
        create: { phone, status: "approved" },
      });

      const wallet = await tx.wallet.upsert({
        where: { userId: user.id },
        update: {},
        create: { userId: user.id },
      });

      await tx.session.deleteMany({ where: { userId: user.id } });
      await tx.session.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt,
        },
      });

      return { user, wallet };
    });

    console.log(`[auth] verify success`, { userId: payload.user.id, tokenHash });

    res.json({
      token: sessionToken,
      expiresAt,
      user: {
        id: payload.user.id,
        phone: payload.user.phone,
        displayName: payload.user.displayName,
        avatarUrl: payload.user.avatarUrl,
      },
      wallet: {
        id: payload.wallet.id,
        balance: payload.wallet.balance,
      },
    });
  } catch (error) {
    console.error("auth verify failed", error);
    next(error);
  }
});

app.get(["/auth/session", "/session"], async (req, res, next) => {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      return res.status(401).json({ message: "Missing or invalid Authorization header" });
    }

    const session = await fetchActiveSession(token);
    if (!session || !session.user) {
      console.warn("[auth] session not found", { path: req.path });
      return res.status(401).json({ message: "Session not found" });
    }

    const wallet = await resolveWallet(session.user.id, session.user.wallet);

    res.json({
      session: {
        id: session.id,
        tokenHash: session.tokenHash,
        expiresAt: session.expiresAt,
        user: {
          id: session.user.id,
          phone: session.user.phone,
          displayName: session.user.displayName,
          avatarUrl: session.user.avatarUrl,
        },
      },
      wallet: wallet
        ? {
            id: wallet.id,
            balance: wallet.balance,
          }
        : null,
    });
  } catch (error) {
    console.error("auth session lookup failed", error);
    next(error);
  }
});

app.get("/profile", async (req, res, next) => {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      return res.status(401).json({ message: "Missing or invalid Authorization header" });
    }

    const session = await fetchActiveSession(token);
    if (!session || !session.user) {
      return res.status(401).json({ message: "Session not found" });
    }

    const wallet = await resolveWallet(session.user.id, session.user.wallet);

    res.json({
      user: {
        id: session.user.id,
        phone: session.user.phone,
        displayName: session.user.displayName,
        avatarUrl: session.user.avatarUrl,
      },
      wallet: wallet
        ? {
            id: wallet.id,
            balance: wallet.balance,
          }
        : null,
    });
  } catch (error) {
    next(error);
  }
});

app.put("/profile", async (req, res, next) => {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      return res.status(401).json({ message: "Missing or invalid Authorization header" });
    }

    const session = await fetchActiveSession(token);
    if (!session || !session.user) {
      return res.status(401).json({ message: "Session not found" });
    }

    const payload = profileUpdateSchema.parse(req.body ?? {});

    const updateData: Prisma.UserUpdateInput = {};
    if (Object.prototype.hasOwnProperty.call(payload, "displayName")) {
      const raw = payload.displayName ?? null;
      const trimmed = typeof raw === "string" ? raw.trim() : null;
      updateData.displayName = trimmed && trimmed.length > 0 ? trimmed : null;
    }
    if (Object.prototype.hasOwnProperty.call(payload, "avatarUrl")) {
      const raw = typeof payload.avatarUrl === "string" ? payload.avatarUrl.trim() : payload.avatarUrl;
      if (raw === null || raw === "") {
        updateData.avatarUrl = null;
      } else if (typeof raw === "string") {
        const looksLikeHttp = /^https?:\/\//i.test(raw);
        const looksLikeDataUrl = raw.startsWith("data:");
        if (!looksLikeHttp && !looksLikeDataUrl) {
          throw Object.assign(new Error("avatarUrl must be an http(s) URL or data URI"), { statusCode: 400 });
        }
        updateData.avatarUrl = raw;
      }
    }

    const updatedUser = await prisma.user.update({
      where: { id: session.user.id },
      data: updateData,
    });

    res.json({
      user: {
        id: updatedUser.id,
        phone: updatedUser.phone,
        displayName: updatedUser.displayName,
        avatarUrl: updatedUser.avatarUrl,
      },
    });
  } catch (error) {
    next(error);
  }
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: serviceName });
});

app.get("/users/:userId", async (req, res, next) => {
  try {
    const userId = z.string().uuid().parse(req.params.userId);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        displayName: true,
        avatarUrl: true,
      },
    });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json({ user });
  } catch (error) {
    next(error);
  }
});

app.get("/version", (_req, res) => {
  res.json({ version: "0.1.0" });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status = typeof err === "object" && err && "statusCode" in err ? Number((err as any).statusCode) : 500;
  const message = err instanceof Error ? err.message : "Unexpected error";
  res.status(status || 500).json({ message });
});

app.listen(port, () => {
  console.log(`(${serviceName}) listening on port ${port}`);
});
