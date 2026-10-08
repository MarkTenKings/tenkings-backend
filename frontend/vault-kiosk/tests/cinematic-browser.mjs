import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, extname } from "node:path";
import { createRequire } from "node:module";
import { chromium } from "playwright";
const require = createRequire(import.meta.url);
const {
  makeSyntheticProfile,
} = require("../../../packages/vault-contracts/tests/profile-fixtures.js");
const profile = makeSyntheticProfile(72).profile;
const products = [2500, 5000, 10000, 25000].flatMap((priceCents) =>
  ["SPORTS", "POKEMON"].map((category) => ({
    id: `${category}-${priceCents}`,
    name: `${category === "SPORTS" ? "Sports" : "Pokémon"} Mystery Pack`,
    description: "Synthetic test product",
    photoUrl: "https://example.test/preview.png",
    category,
    priceCents,
    active: true,
  })),
);
const fresh = () => ({
  stateVersion: 1,
  sequence: 1,
  mode: "CERTIFICATION",
  publicState: "SHOPPING_EMPTY",
  health: "READY",
  readinessReasons: [],
  serviceLocked: false,
  configVersion: 1,
  configSchemaVersion: 2,
  machineProfile: profile,
  city: "Test City",
  state: "CA",
  taxRateBasisPoints: 825,
  products,
  doors: profile.doors.map((d, i) => ({
    doorId: d.doorId,
    productId: products[i % products.length].id,
    state: i === 16 ? "EMPTY" : "AVAILABLE",
    selected: false,
  })),
  cart: [],
  providerLimits: { maxItems: 10, maxTotalCents: 50000 },
  support: {
    pageUrl: "https://support.invalid/vault",
    email: "help@example.test",
    textNumber: "+15555550100",
    phoneNumber: "+15555550101",
    hours: "Test hours",
  },
  activeSale: null,
  idleSecondsRemaining: null,
  buildIdentity: null,
  reservationConflictDoorIds: [],
  preservedDoorIds: [],
});
let state = fresh(),
  calls = [];
const dist = resolve("dist"),
  output = process.env.VAULT_SCREENSHOT_DIR;
if (output) mkdirSync(output, { recursive: true });
const mutate = (patch) => {
  state = {
    ...state,
    ...patch,
    sequence: state.sequence + 1,
    stateVersion: state.stateVersion + 1,
  };
};
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  res.setHeader("Cache-Control", "no-store");
  if (url.pathname.startsWith("/api/")) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length
      ? JSON.parse(Buffer.concat(chunks).toString())
      : {};
    if (req.method === "POST") calls.push({ path: url.pathname, body });
    if (url.pathname.endsWith("/cart/select")) {
      const door = state.doors.find((d) => d.doorId === body.doorId),
        product = products.find((p) => p.id === door.productId);
      assert.equal(body.productId, door.productId);
      const cart = body.selected
        ? [
            ...state.cart.filter((l) => l.doorId !== door.doorId),
            {
              doorId: door.doorId,
              doorLabel: profile.doors.find((d) => d.doorId === door.doorId)
                .label,
              productId: product.id,
              productName: product.name,
              priceCents: product.priceCents,
            },
          ]
        : state.cart.filter((l) => l.doorId !== door.doorId);
      mutate({
        cart,
        publicState: cart.length ? "SHOPPING_WITH_CART" : "SHOPPING_EMPTY",
      });
    }
    if (url.pathname.endsWith("/checkout")) {
      assert.deepEqual(
        body.doorIds,
        state.cart.map((l) => l.doorId),
      );
      const subtotal = state.cart.reduce((n, l) => n + l.priceCents, 0),
        tax = Math.round(subtotal * 0.0825);
      mutate({
        activeSale: {
          saleId: "11111111-1111-4111-8111-111111111111",
          supportReference: "SAFE123",
          items: state.cart.map((l) => ({
            ...l,
            lineId: l.doorId,
            category: "SPORTS",
            photoUrl: products[0].photoUrl,
            description: "Synthetic",
            taxClass: "GENERAL",
          })),
          subtotalCents: subtotal,
          taxCents: tax,
          totalCents: subtotal + tax,
          paidDoorIds: [],
          state: "RESERVED",
          paymentState: "NOT_REQUESTED",
          retryAvailable: false,
          retryUsed: false,
          cancelAvailable: true,
          retrievalSecondsRemaining: null,
          resetSecondsRemaining: null,
        },
      });
    }
    if (url.pathname.endsWith("/payment")) {
      const paid = state.activeSale.items.map((l) => l.doorId);
      mutate({
        cart: [],
        publicState: "PAID_RESET_COUNTDOWN",
        doors: state.doors.map((d) =>
          paid.includes(d.doorId)
            ? { ...d, productId: null, state: "SOLD_UNCONFIRMED" }
            : d,
        ),
        activeSale: {
          ...state.activeSale,
          state: "OPEN_COMMAND_TERMINAL",
          paymentState: "SETTLED",
          paidDoorIds: paid,
          retryAvailable: true,
          retryUsed: false,
          resetSecondsRemaining: 30,
        },
      });
    }
    if (url.pathname.endsWith("/open-doors"))
      mutate({
        activeSale: {
          ...state.activeSale,
          retryAvailable: false,
          retryUsed: true,
        },
      });
    if (url.pathname.endsWith("/done"))
      mutate({ activeSale: null, cart: [], publicState: "SHOPPING_EMPTY" });
    if (
      url.pathname.endsWith("/activity") &&
      state.publicState === "IDLE_WARNING"
    )
      mutate({
        publicState: state.cart.length
          ? "SHOPPING_WITH_CART"
          : "SHOPPING_EMPTY",
        idleSecondsRemaining: null,
      });
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        requestId: "cinematic-test",
        data: url.pathname.endsWith("/bootstrap")
          ? { expiresAt: "2099-01-01T00:00:00Z" }
          : state,
      }),
    );
    return;
  }
  const pathname = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const file = resolve(dist, pathname);
  if (!file.startsWith(dist + "/") || !existsSync(file)) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.setHeader(
    "Content-Type",
    {
      ".html": "text/html",
      ".js": "text/javascript",
      ".css": "text/css",
      ".png": "image/png",
    }[extname(file)] ?? "application/octet-stream",
  );
  res.end(readFileSync(file));
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  headless: true,
  ...(process.platform === "darwin" ? { channel: "chrome" } : {}),
});
const results = [];
try {
  for (const [width, height] of [
    [1920, 1080],
    [1280, 720],
    [768, 1024],
    [390, 844],
  ]) {
    state = fresh();
    calls = [];
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
      hasTouch: true,
    });
    const page = await context.newPage(),
      errors = [],
      assets = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (response.url().includes("/art/vault/"))
        assets.push({ url: response.url(), status: response.status() });
    });
    await page.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin
        ? route.continue()
        : route.abort(),
    );
    await page.addInitScript(() => {
      window.WebSocket = class extends EventTarget {
        close() {}
      };
    });
    await page.goto(`${origin}/?experience=cinematic`);
    await page.locator(".world-ready").waitFor();
    await page.waitForFunction(
      () =>
        document.querySelector(".world-door")?.style.visibility === "visible" &&
        getComputedStyle(document.querySelector(".vault-world")).opacity ===
          "1",
    );
    assert.equal(await page.locator(".world-door").count(), 3);
    assert.equal(
      await page
        .getByRole("button", { name: "D17, unavailable", exact: true })
        .isDisabled(),
      true,
    );
    const geometry = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      doors: [...document.querySelectorAll(".world-door")].map((el) => {
        const r = el.getBoundingClientRect();
        return { w: r.width, h: r.height };
      }),
    }));
    assert.equal(geometry.overflow, false, `horizontal overflow at ${width}`);
    assert.ok(geometry.doors.every((d) => d.w >= 44 && d.h >= 44));
    if (width <= 900)
      assert.ok(
        await page.evaluate(
          () =>
            document.querySelector(".vault-hud").getBoundingClientRect()
              .bottom <
            document.querySelector(".vault-world").getBoundingClientRect().top,
        ),
        "mobile header and product controls must precede the scene",
      );
    if (output)
      await page.screenshot({
        path: resolve(output, `vault-cinematic-${width}.png`),
        fullPage: true,
      });
    await page
      .getByRole("button", { name: "D1, available", exact: true })
      .click();
    await page
      .getByRole("button", { name: "D1, selected", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Remove door D1", exact: true })
      .click();
    await page
      .getByRole("button", { name: "D1, available", exact: true })
      .waitFor();
    calls = [];
    // A single touch must preserve exact identity, even while camera motion is active.
    await page
      .getByRole("button", { name: "D9, available", exact: true })
      .tap();
    await page
      .getByRole("button", { name: "D9, selected", exact: true })
      .waitFor();
    const selections = calls.filter((c) => c.path.endsWith("/cart/select"));
    assert.equal(selections.length, 1);
    assert.equal(selections[0].body.doorId, "door-0009");
    await page.getByRole("button", { name: "Next doors", exact: true }).click();
    await page
      .getByRole("button", { name: "D25, available", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Remove door D9", exact: true })
        .count(),
      1,
    );
    await page.getByRole("button", { name: "Pokémon", exact: true }).click();
    await page
      .getByRole("button", { name: "D2, available", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Remove door D9", exact: true })
        .count(),
      1,
    );
    await page
      .getByRole("button", { name: "Review order", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Make it yours.",
      exact: true,
    });
    await dialog.waitFor();
    assert.equal(
      await dialog
        .getByRole("button", { name: "Pay $27.06", exact: true })
        .count(),
      1,
    );
    await page.keyboard.press("Tab");
    assert.ok(
      await page.evaluate(() =>
        document.querySelector("dialog").contains(document.activeElement),
      ),
    );
    if (output && width === 1920)
      await page.screenshot({
        path: resolve(output, "vault-cinematic-review.png"),
      });
    await dialog
      .getByRole("button", { name: "Pay $27.06", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "It’s yours.", exact: true })
      .waitFor();
    assert.equal(calls.filter((c) => c.path.endsWith("/checkout")).length, 1);
    assert.equal(calls.filter((c) => c.path.endsWith("/payment")).length, 1);
    assert.deepEqual(state.activeSale.paidDoorIds, ["door-0009"]);
    await page.getByRole("button", { name: "D9, paid", exact: true }).waitFor();
    assert.equal(
      await page.locator(".world-door").count(),
      3,
      "surrounding inventory remains visible during reveal",
    );
    if (output && width === 1920) {
      await page.waitForTimeout(1600);
      await page.screenshot({
        path: resolve(output, "vault-cinematic-collect.png"),
      });
    }
    await page.getByRole("button", { name: "OPEN DOORS", exact: true }).click();
    await page.locator(".retry-action").waitFor({ state: "detached" });
    assert.equal(calls.filter((c) => c.path.endsWith("/open-doors")).length, 1);
    await page
      .getByRole("button", { name: "I GOT MY PACKS — DONE", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Review order", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Review order", exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(
      state.doors.find((d) => d.doorId === "door-0009").state,
      "SOLD_UNCONFIRMED",
    );
    // Unknown payment must keep the receipt/recovery controls, never show the celebration or retry.
    mutate({
      activeSale: {
        saleId: "11111111-1111-4111-8111-111111111111",
        supportReference: "SAFE123",
        items: [
          {
            doorId: "door-0009",
            doorLabel: "D9",
            productId: products[0].id,
            productName: products[0].name,
            priceCents: 2500,
          },
        ],
        totalCents: 2706,
        paymentState: "UNKNOWN",
        state: "PAYMENT_UNKNOWN",
        paidDoorIds: [],
        retryAvailable: false,
        retryUsed: false,
        retrievalSecondsRemaining: null,
        resetSecondsRemaining: null,
      },
      publicState: "PAYMENT_UNKNOWN",
    });
    await page.reload();
    await page
      .getByRole("heading", { name: "Do not pay again", exact: true })
      .waitFor();
    assert.equal(
      await page
        .locator(".collection-headline,.retry-action,.payment-continue-action")
        .count(),
      0,
    );
    assert.ok(
      assets.some((a) => a.url.endsWith("pack-front.png") && a.status === 200),
    );
    assert.ok(
      assets.some(
        (a) => a.url.endsWith("door-surface.png") && a.status === 200,
      ),
    );
    assert.deepEqual(errors, []);
    results.push({
      viewport: `${width}x${height}`,
      pass: true,
      minDoorWidth: Math.round(Math.min(...geometry.doors.map((d) => d.w))),
      checks:
        "single-touch stable ID, gallery/category retained cart, modal focus, exact checkout/payment, paid reveal, one retry, Done, unknown payment, local assets",
    });
    console.log(`PASS cinematic ${width}x${height}`);
    await context.close();
  }
  // No-WebGL path must still offer actionable exact-ID controls.
  state = fresh();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (String(type).startsWith("webgl")) return null;
      return original.call(this, type, ...args);
    };
    window.WebSocket = class extends EventTarget {
      close() {}
    };
  });
  await page.goto(`${origin}/?experience=cinematic`);
  await page.locator(".world-fallback").waitFor();
  await page
    .getByRole("button", { name: "D1, available", exact: true })
    .click();
  await page
    .getByRole("button", { name: "D1, selected", exact: true })
    .waitFor();
  await page.getByRole("button",{name:"Review order",exact:true}).click();
  await page.waitForTimeout(650); // Allow the preceding tap’s activity debounce to finish.
  mutate({publicState:"IDLE_WARNING",idleSecondsRemaining:10});
  const keep=page.getByRole("button",{name:"CONTINUE SHOPPING",exact:true});
  await keep.waitFor();
  await page.locator(".vault-review-dialog").waitFor({state:"hidden"});
  await keep.click();
  await page.locator(".idle-overlay").waitFor({state:"detached"});
  assert.equal(state.cart.length,1,"idle continuation retains the exact selection");
  await context.close();
  console.log("PASS no-WebGL exact-ID fallback and idle-over-review recovery");
  if (output)
    writeFileSync(
      resolve(output, "browser-validation.json"),
      JSON.stringify({ results, webglFallback: true }, null, 2),
    );
} finally {
  await new Promise((done) => {
    server.close(done);
    server.closeAllConnections();
  });
  // Bound teardown: a stalled browser close must not retain the test process.
  let closeTimer;
  try {
    await Promise.race([
      browser.close(),
      new Promise((done) => { closeTimer = setTimeout(done, 5000); }),
    ]);
  } finally {
    clearTimeout(closeTimer);
  }
}
