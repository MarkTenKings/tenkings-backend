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

const sendCodeSchema = z.object({
  phone: phoneSchema,
});

app.post(["/auth/send-code", "/send-code"], async (req, res, next) => {
  try {
    if (!twilioClient || !verifyServiceSid) {
      return res.status(503).json({ message: "Twilio verify not configured" });
    }

    const { phone } = sendCodeSchema.parse(req.body);

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

    res.json({
      token: sessionToken,
      expiresAt,
      user: {
        id: payload.user.id,
        phone: payload.user.phone,
        displayName: payload.user.displayName,
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

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: serviceName });
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
