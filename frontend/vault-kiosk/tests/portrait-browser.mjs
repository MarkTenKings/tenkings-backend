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
            category: products.find((product) => product.id === l.productId)
              .category,
            photoUrl: products.find((product) => product.id === l.productId)
              .photoUrl,
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
    [1080, 1920],
    [540, 960],
    [1280, 720],
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
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("response", (r) => {
      if (r.url().includes("/art/vault/")) assets.push([r.url(), r.status()]);
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
    await page.goto(`${origin}/?experience=portrait`);
    await page.locator(".portrait-world-ready").waitFor();
    await page
      .getByRole("button", { name: "Door D6, available", exact: true })
      .waitFor();
    await page.waitForFunction(
      () => document.querySelector(".portrait-world").dataset.fps,
    );
    assert.equal(await page.locator(".portrait-door").count(), 68);
    assert.equal(
      await page
        .getByRole("button", { name: "Door D1, other pack", exact: true })
        .isDisabled(),
      true,
    );
    const geometry = await page.evaluate(() => {
      const r = (s) => document.querySelector(s).getBoundingClientRect(),
        frame = r(".portrait-frame"),
        top = r(".portrait-top"),
        bottom = r(".portrait-bottom"),
        door = r(".portrait-door"),
        doorView = r(".portrait-door-viewport"),
        shelf = r(".portrait-product-shelf"),
        hud = r(".portrait-checkout"),
        scroll = document.querySelector(".portrait-page");
      return {
        frame: { w: frame.width, h: frame.height },
        top: top.height,
        bottom: bottom.height,
        door: { w: door.width, h: door.height },
        doorViewHeight: doorView.height,
        shelfWidth: shelf.width,
        hudBottom: hud.bottom,
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
        pageOverflow: scroll.scrollHeight > scroll.clientHeight + 1,
        metrics: { ...document.querySelector(".portrait-world").dataset },
      };
    });
    assert.ok(
      geometry.top < geometry.frame.h * 0.38 &&
        geometry.bottom > geometry.top * 1.6,
      "compact product shelf gives most of the screen to doors",
    );
    assert.ok(
      Math.abs(geometry.door.w / geometry.door.h - 2.4) < 0.02,
      "physical face proportions",
    );
    assert.equal(geometry.overflow, false);
    assert.equal(geometry.pageOverflow, false);
    assert.ok(
      geometry.shelfWidth <= geometry.frame.w,
      "slider stays inside the cabinet frame",
    );
    assert.ok(
      geometry.hudBottom <= height,
      "checkout visible without page scroll",
    );
    if (width === 1080)
      assert.ok(geometry.door.w >= 44 && geometry.door.h >= 44);
    if (output)
      await page.screenshot({
        path: resolve(output, `vault-portrait-${width}.png`),
        fullPage: true,
      });
    const shelf = page.locator(".portrait-product-shelf");
    assert.equal(await shelf.locator(".portrait-product-card").count(), 8);
    const chosenProduct = await shelf
      .locator('[aria-pressed="true"]')
      .getAttribute("data-product-id");
    const shelfBox = await shelf.boundingBox();
    const initialScroll = await shelf.evaluate((el) => el.scrollLeft);
    const touch = await context.newCDPSession(page);
    const touchY = shelfBox.y + shelfBox.height * 0.4;
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: shelfBox.x + shelfBox.width * 0.8, y: touchY }],
    });
    for (let step = 1; step <= 8; step++) {
      await touch.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          { x: shelfBox.x + shelfBox.width * (0.8 - step * 0.07), y: touchY },
        ],
      });
      await page.waitForTimeout(20);
    }
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await page.waitForTimeout(600);
    assert.ok(
      (await shelf.evaluate((el) => el.scrollLeft)) > initialScroll + 20,
      "native horizontal swipe browses later products",
    );
    assert.equal(
      await shelf
        .locator('[aria-pressed="true"]')
        .getAttribute("data-product-id"),
      chosenProduct,
      "swiping does not change the product",
    );
    assert.equal(
      calls.filter((c) => c.path.endsWith("/cart/select")).length,
      0,
      "browsing never chooses a door",
    );
    await touch.detach();
    const beforeDrag = await shelf.evaluate((el) => el.scrollLeft);
    await page.mouse.move(shelfBox.x + shelfBox.width * 0.2, touchY);
    await page.mouse.down();
    await page.mouse.move(shelfBox.x + shelfBox.width * 0.8, touchY, {
      steps: 12,
    });
    await page.mouse.up();
    await page.waitForTimeout(400);
    assert.ok(
      (await shelf.evaluate((el) => el.scrollLeft)) < beforeDrag - 20,
      "mouse drag browses earlier products",
    );
    assert.equal(
      await shelf
        .locator('[aria-pressed="true"]')
        .getAttribute("data-product-id"),
      chosenProduct,
      "drag release does not select a product",
    );
    await page.getByRole("button", { name: "Pokémon", exact: true }).click();
    assert.equal(await shelf.locator(".portrait-product-card").count(), 4);
    const selectedCard = shelf.locator('[aria-pressed="true"]');
    await selectedCard.focus();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page
      .getByRole("button", { name: "Door D8, available", exact: true })
      .waitFor();
    assert.equal(
      await shelf
        .locator('[aria-pressed="true"] .portrait-pack-concept')
        .textContent(),
      "Preview art",
    );
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Enter");
    await page
      .getByRole("button", { name: "Door D6, available", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "All packs", exact: true }).click();
    const before = await page
      .locator('[data-door-id="door-0006"]')
      .getAttribute("style");
    await page
      .getByRole("button", { name: "Door D6, available", exact: true })
      .tap();
    await page
      .getByRole("button", { name: "Door D6, selected", exact: true })
      .waitFor();
    assert.equal(
      calls.filter((c) => c.path.endsWith("/cart/select")).length,
      1,
    );
    assert.equal(
      calls.find((c) => c.path.endsWith("/cart/select")).body.doorId,
      "door-0006",
    );
    await page.getByRole("button", { name: "Sports", exact: true }).click();
    await page
      .getByRole("button", { name: "Door D5, available", exact: true })
      .waitFor();
    assert.equal(
      await page.locator('[data-door-id="door-0006"]').getAttribute("style"),
      before,
      "product changes never rearrange doors",
    );
    assert.equal(
      await page
        .getByRole("button", { name: "Remove door D6", exact: true })
        .count(),
      1,
    );
    await page
      .getByRole("button", { name: "Go to row 17", exact: true })
      .click();
    await page.waitForTimeout(600);
    assert.ok(
      await page.evaluate(() => {
        const d = document
            .querySelector('[data-door-id="door-0068"]')
            .getBoundingClientRect(),
          v = document
            .querySelector(".portrait-door-viewport")
            .getBoundingClientRect();
        return d.top >= v.top && d.bottom <= v.bottom + 1;
      }),
      "last row reachable",
    );
    await page
      .getByRole("button", { name: "Next matching ↓", exact: true })
      .click();
    await page.waitForTimeout(600);
    await page
      .getByRole("button", { name: "Review order ↗", exact: true })
      .click();
    const dialog = page.locator(".portrait-review");
    await dialog.waitFor({ state: "visible" });
    assert.equal(
      await dialog
        .getByRole("button", { name: "Pay $108.25 ↗", exact: true })
        .count(),
      1,
    );
    await page.keyboard.press("Tab");
    assert.ok(
      await page.evaluate(() =>
        document.querySelector("dialog").contains(document.activeElement),
      ),
    );
    if (output && width === 1080)
      await page.screenshot({
        path: resolve(output, "vault-portrait-review.png"),
      });
    await dialog
      .getByRole("button", { name: "Pay $108.25 ↗", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Door D6, collect", exact: true })
      .waitFor();
    assert.deepEqual(state.activeSale.paidDoorIds, ["door-0006"]);
    assert.equal(calls.filter((c) => c.path.endsWith("/checkout")).length, 1);
    assert.equal(calls.filter((c) => c.path.endsWith("/payment")).length, 1);
    assert.equal(await page.locator(".portrait-door.is-paid").count(), 1);
    await page.waitForTimeout(1000);
    if (output && width === 1080)
      await page.screenshot({
        path: resolve(output, "vault-portrait-collect.png"),
      });
    await page.getByRole("button", { name: "OPEN DOORS", exact: true }).click();
    await page.locator(".retry-action").waitFor({ state: "detached" });
    assert.equal(calls.filter((c) => c.path.endsWith("/open-doors")).length, 1);
    await page
      .getByRole("button", { name: "I GOT MY PACKS — DONE", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Review order ↗", exact: true })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Review order ↗", exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(
      state.doors.find((d) => d.doorId === "door-0006").state,
      "SOLD_UNCONFIRMED",
    );
    mutate({
      publicState: "PAYMENT_UNKNOWN",
      activeSale: {
        saleId: "11111111-1111-4111-8111-111111111111",
        supportReference: "SAFE123",
        items: [
          {
            doorId: "door-0006",
            doorLabel: "D6",
            productId: products[5].id,
            productName: products[5].name,
            priceCents: 10000,
          },
        ],
        totalCents: 10825,
        paymentState: "UNKNOWN",
        state: "PAYMENT_UNKNOWN",
        paidDoorIds: ["door-0006"],
        retryAvailable: false,
        retryUsed: false,
        retrievalSecondsRemaining: null,
        resetSecondsRemaining: null,
      },
    });
    await page.reload();
    await page
      .getByRole("heading", { name: "Do not pay again", exact: true })
      .waitFor();
    assert.equal(
      await page
        .locator(
          ".portrait-door.is-paid,.retry-action,.payment-continue-action",
        )
        .count(),
      0,
    );
    assert.deepEqual(errors, []);
    for (const asset of [
      "pack-front.png",
      "pack-pokemon.png",
      "door-wide-titanium.png",
      "ten-kings-logo.png",
      "products/sports-25.png",
      "products/sports-50.png",
      "products/sports-100.png",
      "products/pokemon-25.png",
      "products/pokemon-50.png",
      "products/pokemon-100.png",
    ])
      assert.ok(
        assets.some(([url, status]) => url.endsWith(asset) && status === 200),
      );
    results.push({ viewport: `${width}x${height}`, pass: true, ...geometry });
    console.log(`PASS portrait ${width}x${height}`);
    await context.close();
  }
  state = fresh();
  calls = [];
  const context = await browser.newContext({
      viewport: { width: 540, height: 960 },
    }),
    page = await context.newPage();
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
  await page.goto(`${origin}/?experience=portrait`);
  await page.locator(".portrait-world-fallback").waitFor();
  await page
    .getByRole("button", { name: "Door D6, available", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Door D6, selected", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Review order ↗", exact: true })
    .click();
  await page.waitForTimeout(650);
  mutate({ publicState: "IDLE_WARNING", idleSecondsRemaining: 10 });
  const keep = page.getByRole("button", {
    name: "CONTINUE SHOPPING",
    exact: true,
  });
  await keep.waitFor();
  await page.locator(".portrait-review").waitFor({ state: "hidden" });
  await keep.click();
  await page.locator(".idle-overlay").waitFor({ state: "detached" });
  assert.equal(state.cart.length, 1);
  await context.close();
  console.log("PASS portrait no-WebGL and idle recovery");
  if (output)
    writeFileSync(
      resolve(output, "browser-validation.json"),
      JSON.stringify({ results, fallbackAndIdle: true }, null, 2),
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
