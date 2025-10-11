import request from "supertest";
import { createApp } from "../src/app";
import { PrismaStub } from "./helpers/prismaStub";
import { TransactionSource, TransactionType } from "@tenkings/database";

const operatorKey = "operator-test-key";

function buildApp(prisma: PrismaStub) {
  return createApp({ prisma: prisma as unknown as any, operatorKey });
}

describe("wallet-service", () => {
  it("rejects protected routes without operator key", async () => {
    const prisma = new PrismaStub();
    const app = buildApp(prisma);
    const userResponse = await request(app).post("/users").send({ email: "alice@example.com" });
    expect(userResponse.status).toBe(201);
    const userId = userResponse.body.user.id;

    const res = await request(app)
      .post(`/wallets/${userId}/credit`)
      .send({ amount: 100, source: TransactionSource.BUYBACK });
    expect(res.status).toBe(401);
  });

  it("credits wallet balances for allowed sources", async () => {
    const prisma = new PrismaStub();
    const app = buildApp(prisma);

    const user = await request(app).post("/users").send({ email: "bob@example.com" });
    const userId = user.body.user.id;

    const credit = await request(app)
      .post(`/wallets/${userId}/credit`)
      .set("x-operator-key", operatorKey)
      .send({
        amount: 500,
        source: TransactionSource.BUYBACK,
        note: "Instant buyback",
        referenceId: "item-123",
      });

    expect(credit.status).toBe(201);
    expect(credit.body.balance).toBe(500);
    expect(credit.body.transaction.source).toBe(TransactionSource.BUYBACK);
    expect(credit.body.transaction.type).toBe(TransactionType.CREDIT);

    const wallet = prisma.getWalletByUserId(userId);
    expect(wallet?.balance).toBe(500);
  });

  it("rejects credit with disallowed source", async () => {
    const prisma = new PrismaStub();
    const app = buildApp(prisma);
    const user = await request(app).post("/users").send({ email: "carol@example.com" });
    const userId = user.body.user.id;

    const response = await request(app)
      .post(`/wallets/${userId}/credit`)
      .set("x-operator-key", operatorKey)
      .send({ amount: 200, source: TransactionSource.PACK_PURCHASE });

    expect(response.status).toBe(400);
    expect(response.body.message).toMatch(/not permitted/i);
  });

  it("cannot debit beyond available balance", async () => {
    const prisma = new PrismaStub();
    const app = buildApp(prisma);
    const user = await request(app).post("/users").send({ email: "dana@example.com" });
    const userId = user.body.user.id;

    await request(app)
      .post(`/wallets/${userId}/credit`)
      .set("x-operator-key", operatorKey)
      .send({ amount: 150, source: TransactionSource.BUYBACK });

    const debit = await request(app)
      .post(`/wallets/${userId}/debit`)
      .set("x-operator-key", operatorKey)
      .send({ amount: 200, source: TransactionSource.PACK_PURCHASE });

    expect(debit.status).toBe(400);
    expect(debit.body.message).toMatch(/insufficient/i);
  });

  it("transfers balances between wallets while recording both sides", async () => {
    const prisma = new PrismaStub();
    const app = buildApp(prisma);

    const alice = await request(app).post("/users").send({ email: "alice@tenkings.com" });
    const bob = await request(app).post("/users").send({ email: "bob@tenkings.com" });
    const aliceId = alice.body.user.id;
    const bobId = bob.body.user.id;

    await request(app)
      .post(`/wallets/${aliceId}/credit`)
      .set("x-operator-key", operatorKey)
      .send({ amount: 1000, source: TransactionSource.BUYBACK });

    const transfer = await request(app)
      .post("/wallets/transfer")
      .set("x-operator-key", operatorKey)
      .send({
        fromUserId: aliceId,
        toUserId: bobId,
        amount: 400,
        source: TransactionSource.SALE,
        referenceId: "listing-789",
      });

    expect(transfer.status).toBe(201);
    expect(transfer.body.transfer.from.balance).toBe(600);
    expect(transfer.body.transfer.to.balance).toBe(400);
    expect(transfer.body.transfer.to.transaction.type).toBe(TransactionType.CREDIT);
    expect(transfer.body.transfer.from.transaction.type).toBe(TransactionType.DEBIT);

    const aliceTransactions = prisma.getTransactions(transfer.body.transfer.from.walletId);
    const bobTransactions = prisma.getTransactions(transfer.body.transfer.to.walletId);

    expect(aliceTransactions).toHaveLength(2);
    expect(bobTransactions).toHaveLength(1);
    expect(bobTransactions[0].source).toBe(TransactionSource.SALE);
  });

  it("lists recent transactions in reverse chronological order", async () => {
    const prisma = new PrismaStub();
    const app = buildApp(prisma);
    const user = await request(app).post("/users").send({ email: "erin@example.com" });
    const userId = user.body.user.id;

    await request(app)
      .post(`/wallets/${userId}/credit`)
      .set("x-operator-key", operatorKey)
      .send({ amount: 300, source: TransactionSource.BUYBACK });

    await request(app)
      .post(`/wallets/${userId}/debit`)
      .set("x-operator-key", operatorKey)
      .send({ amount: 100, source: TransactionSource.PACK_PURCHASE });

    const history = await request(app)
      .get(`/wallets/${userId}/transactions`)
      .set("x-operator-key", operatorKey);

    expect(history.status).toBe(200);
    expect(history.body.transactions).toHaveLength(2);
    expect(history.body.transactions[0].type).toBe(TransactionType.DEBIT);
    const [latest, older] = history.body.transactions;
    expect(new Date(latest.createdAt).getTime()).toBeGreaterThanOrEqual(
      new Date(older.createdAt).getTime(),
    );
  });
});
