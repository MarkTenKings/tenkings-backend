import request from "supertest";
import { createApp } from "../src/app";
import { PrismaStub } from "./helpers/prismaStub";

describe("health checks", () => {
  it("returns the service status", async () => {
    const prisma = new PrismaStub();
    const app = createApp({ prisma: prisma as unknown as any });
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.service).toBe("wallet-service");
  });

  it("exposes version information", async () => {
    const prisma = new PrismaStub();
    const app = createApp({ prisma: prisma as unknown as any });
    const res = await request(app).get("/version");
    expect(res.status).toBe(200);
    expect(res.body.version).toBe("0.1.0");
  });
});
