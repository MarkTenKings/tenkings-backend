import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, extname } from "node:path";
import { chromium } from "playwright";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { makeSyntheticProfile } = require("../../../packages/vault-contracts/tests/profile-fixtures.js");

assert.equal(process.versions.node.split(".")[0], "20", "Vault browser validation requires Node 20");
const columns = ["X", "K", "I", "N", "G", "S"];
const ids = Array.from({ length: 25 }, (_, row) => columns.map((column) => `${column}-${String(row + 1).padStart(2, "0")}`)).flat();
const products = [2500, 5000, 10000, 25000].flatMap((price, index) => ["SPORTS", "POKEMON"].map((category) => ({ id: `${category}-${index}`, name: `${category === "SPORTS" ? "Sports" : "Pokémon"} Mystery Pack`, description: "Choose a mystery pack from the exact cabinet door shown.", photoUrl: "https://media.invalid/test.png", priceCents: price, category, active: true })));
let state = {
  stateVersion: 1, sequence: 1, mode: "CERTIFICATION", publicState: "SHOPPING_WITH_CART", health: "READY", readinessReasons: [], serviceLocked: false, configVersion: 1,
  configSchemaVersion: 1, machineProfile: null,
  city: "Test City", state: "CA", taxRateBasisPoints: 825, products,
  doors: ids.map((doorId, index) => ({ doorId, productId: products[index % products.length].id, state: "AVAILABLE", selected: index === 0 })),
  cart: [{ doorId: "X-01", productId: products[0].id, productName: products[0].name, priceCents: 2500 }], providerLimits: { maxItems: 50, maxTotalCents: 1000000 },
  support: { pageUrl: "https://support.invalid/vault", email: "vault@example.test", textNumber: "+15555550101", phoneNumber: "+15555550102", hours: "Test hours" },
  activeSale: null, idleSecondsRemaining: 60, buildIdentity: { sourceCommit: "a".repeat(40), appVersion: "1.0.0" }, reservationConflictDoorIds: [], preservedDoorIds: [],
};
const historicalFixture = structuredClone(state);
const fixtures = [{ name: "historical-150", snapshot: historicalFixture }, ...[7, 72, 125].map((count) => {
  const profile = makeSyntheticProfile(count).profile;
  return { name: `synthetic-mixed-${count}`, snapshot: { ...historicalFixture, configSchemaVersion: 2, machineProfile: profile,
    doors: profile.doors.map((door, index) => ({ doorId: door.doorId, productId: products[index % products.length].id, state: "AVAILABLE", selected: index === 0 })),
    cart: [{ ...historicalFixture.cart[0], doorId: profile.doors[0].doorId, doorLabel: profile.doors[0].label }],
  } };
})];
const longLabelProfile = makeSyntheticProfile(7).profile;
longLabelProfile.doors[0].label = "W".repeat(32);
fixtures.push({ name: "synthetic-long-label", snapshot: { ...fixtures[1].snapshot, machineProfile: longLabelProfile, cart: [{ ...fixtures[1].snapshot.cart[0], doorLabel: longLabelProfile.doors[0].label }] }, viewports: [[720, 1280, 1.5]] });
let shoppingFixture = historicalFixture;
let retryRequests = 0;
let lastSelection = null;
const dist = resolve("dist");
assert.ok(existsSync(resolve(dist, "index.html")), "Build the kiosk before browser tests");
const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  response.setHeader("Cache-Control", "no-store");
  if (url.pathname.startsWith("/api/")) {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
    response.setHeader("Content-Type", "application/json");
    if (url.pathname.endsWith("/cart/select")) {
      lastSelection = body;
      const door = state.doors.find((entry) => entry.doorId === body.doorId);
      const product = products.find((entry) => entry.id === door.productId);
      const cart = body.selected ? [...state.cart, { doorId: door.doorId, productId: product.id, productName: product.name, priceCents: product.priceCents }] : state.cart.filter((line) => line.doorId !== body.doorId);
      state = { ...state, stateVersion: state.stateVersion + 1, sequence: state.sequence + 1, cart, publicState: cart.length ? "SHOPPING_WITH_CART" : "SHOPPING_EMPTY" };
    }
    if (url.pathname.endsWith("/activity")) state = { ...state, stateVersion: state.stateVersion + 1, sequence: state.sequence + 1, publicState: "SHOPPING_WITH_CART", idleSecondsRemaining: 60 };
    if (url.pathname.endsWith("/open-doors")) {
      retryRequests += 1;
      state = { ...state, stateVersion: state.stateVersion + 1, sequence: state.sequence + 1, activeSale: { ...state.activeSale, retryAvailable: false, retryUsed: true } };
    }
    if (url.pathname.endsWith("/done")) state = { ...shoppingFixture, stateVersion: state.stateVersion + 1, sequence: state.sequence + 1 };
    response.end(JSON.stringify({ requestId: "local-layout-fixture", data: url.pathname.endsWith("/bootstrap") ? { expiresAt: "2099-01-01T00:00:00Z" } : state }));
    return;
  }
  const file = resolve(dist, url.pathname.replace(/^\//, "") || "index.html");
  if (!file.startsWith(dist + "/") || !existsSync(file)) { response.writeHead(404).end(); return; }
  response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://media.invalid; connect-src 'self'; frame-ancestors 'none'");
  response.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css" })[extname(file)] ?? "application/octet-stream");
  response.end(readFileSync(file));
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const address = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.platform === "darwin" ? { channel: "chrome" } : {}) });
const screenshotDir = process.env.VAULT_SCREENSHOT_DIR;
if (screenshotDir) mkdirSync(screenshotDir, { recursive: true });
try {
  for (const fixture of fixtures) {
  shoppingFixture = structuredClone(fixture.snapshot);
  const fixtureIds = shoppingFixture.doors.map((door) => door.doorId);
  const firstDoorId = fixtureIds[0];
  const firstLabel = shoppingFixture.machineProfile?.doors[0].label ?? firstDoorId;
  for (const [width, height, scale] of fixture.viewports ?? [[720, 1280, 1.5], [768, 1366, 1.25], [864, 1536, 1.25], [1080, 1920, 1]]) {
    state = { ...shoppingFixture, stateVersion: state.stateVersion + 1, sequence: state.sequence + 1 };
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    // All external requests are denied. Real cloud/media/provider/hardware is never used.
    await page.route("**/*", (route) => new URL(route.request().url()).origin === address ? route.continue() : route.abort());
    await page.addInitScript(() => {
      window.WebSocket = class extends EventTarget { close() {} };
    });
    await page.goto(address);
    await page.locator(".door-cell").last().waitFor();
    assert.deepEqual(await page.locator(".door-cell").evaluateAll((cells) => cells.map((cell) => cell.dataset.doorId)), fixtureIds);
    const geometry = await page.evaluate(() => {
      const frame = document.querySelector(".door-map-frame");
      const cells = [...document.querySelectorAll(".door-cell")].map((cell) => cell.getBoundingClientRect());
      const checkout = document.querySelector(".checkout-action").getBoundingClientRect();
      return { width: innerWidth, docWidth: document.documentElement.scrollWidth, frameWidth: frame.clientWidth, frameScroll: frame.scrollWidth, cellWidth: Math.min(...cells.map((box) => box.width)), cellHeight: Math.min(...cells.map((box) => box.height)), checkout: { top: checkout.top, bottom: checkout.bottom, height: checkout.height } };
    });
    assert.ok(geometry.docWidth <= width, `page overflow at ${width}: ${JSON.stringify(geometry)}`);
    if (!shoppingFixture.machineProfile) assert.ok(geometry.frameScroll <= geometry.frameWidth + 1, `historical map horizontally clipped at ${width}: ${JSON.stringify(geometry)}`);
    assert.ok(geometry.cellWidth >= 44 && geometry.cellHeight >= 44, `undersized doors at ${width}: ${JSON.stringify(geometry)}`);
    assert.ok(geometry.checkout.height >= 56, "primary checkout touch target must be at least 56 CSS pixels");
    assert.ok(geometry.checkout.top >= 0 && geometry.checkout.bottom <= height, `sticky checkout must be visible at ${width}: ${JSON.stringify(geometry)}`);
    // Size alone is insufficient: a sticky cart can cover the last rows. Prove the
    // final physical door remains in the viewport and is the actual hit-test target.
    await page.locator(".door-cell").last().scrollIntoViewIfNeeded();
    const lastDoorExposed = await page.locator(".door-cell").last().evaluate((door) => {
      const box = door.getBoundingClientRect();
      const target = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return { exposed: box.top >= 0 && box.bottom <= innerHeight && (target === door || door.contains(target)), top: box.top, bottom: box.bottom, height: innerHeight, target: target?.className };
    });
    assert.ok(lastDoorExposed.exposed, `last door is offscreen or covered by the cart at ${width}: ${JSON.stringify(lastDoorExposed)}`);
    await page.locator('.cart-line-focus').click();
    await page.locator(`[data-door-id="${firstDoorId}"].pick-flash`).waitFor();
    assert.ok(await page.locator(`[data-door-id="${firstDoorId}"]`).evaluate((door) => {
      const box = door.getBoundingClientRect();
      const target = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return target === door || door.contains(target);
    }), "cart focus must not hide the exact door behind sticky column headers");
    assert.equal(await page.locator(`[data-door-id="${firstDoorId}"]`).getAttribute("aria-label"), `${firstLabel}, selected`);
    // The UI must send the stable ID, even when the visible printed label differs.
    await page.locator(`[data-door-id="${firstDoorId}"]`).click();
    await page.locator(".empty-cart").waitFor();
    assert.equal(lastSelection.doorId, firstDoorId);
    assert.equal(lastSelection.selected, false);
    await page.locator(`[data-door-id="${firstDoorId}"]`).click();
    await page.locator(".cart-line-focus").waitFor();
    assert.equal(lastSelection.doorId, firstDoorId);
    assert.equal(lastSelection.selected, true);
    const positionsBeforeFilter = await page.locator(".door-cell").evaluateAll((cells) => cells.map((cell) => [cell.dataset.doorId, cell.offsetLeft, cell.offsetTop, cell.offsetWidth, cell.offsetHeight]));
    await page.locator(".product-select").nth(1).click();
    assert.deepEqual(await page.locator(".door-cell").evaluateAll((cells) => cells.map((cell) => [cell.dataset.doorId, cell.offsetLeft, cell.offsetTop, cell.offsetWidth, cell.offsetHeight])), positionsBeforeFilter, "product changes must preserve all door positions and sizes");
    assert.ok(await page.locator(".door-code").evaluateAll((labels) => labels.every((label) => label.scrollWidth <= label.clientWidth + 1 && label.scrollHeight <= label.clientHeight + 1)), "printed labels remain readable without clipping");
    if (shoppingFixture.machineProfile) {
      assert.equal(await page.locator(".profile-cutout").count(), 3);
      assert.ok(await page.evaluate(() => {
        const doors = [...document.querySelectorAll(".spatial-door")].map((door) => door.getBoundingClientRect());
        const cutouts = [...document.querySelectorAll(".profile-cutout")].map((cutout) => cutout.getBoundingClientRect());
        return doors.every((door) => cutouts.every((cutout) => !(door.left < cutout.right - 0.01 && door.right > cutout.left + 0.01 && door.top < cutout.bottom - 0.01 && door.bottom > cutout.top + 0.01)));
      }), "door touch rectangles must not overlap central controls");
    }
    assert.match(await page.locator(".product-select img").first().getAttribute("src"), /^data:image\/svg\+xml,/);
    if (screenshotDir) await page.screenshot({ path: resolve(screenshotDir, `vault-shopping-${fixture.name}-${width}.png`), fullPage: true });
    state = { ...state, sequence: state.sequence + 1, stateVersion: state.stateVersion + 1, publicState: "IDLE_WARNING", idleSecondsRemaining: 10 };
    await page.reload();
    const keep = page.getByRole("button", { name: "CONTINUE SHOPPING", exact: true });
    await keep.waitFor();
    assert.ok(await keep.evaluate((el) => el === document.activeElement), "idle continue must receive focus");
    await page.keyboard.press("Tab");
    assert.ok(await keep.evaluate((el) => el === document.activeElement), "idle dialog must contain focus");
    await keep.click();
    await page.getByRole("dialog").waitFor({ state: "detached" });

    const fixtureSale = {
      saleId: "11111111-1111-4111-8111-111111111111", supportReference: "SAFE123", items: [{ lineId: "22222222-2222-4222-8222-222222222222", doorId: firstDoorId, doorLabel: firstLabel, productId: products[0].id, productName: products[0].name, photoUrl: products[0].photoUrl, description: products[0].description, category: "SPORTS", priceCents: 2500, taxClass: "GENERAL" }],
      subtotalCents: 2500, taxCents: 206, totalCents: 2706, paidDoorIds: [], retryAvailable: false, retryUsed: false,
      state: "PAYMENT_UNKNOWN", paymentState: "UNKNOWN", retrievalSecondsRemaining: null, resetSecondsRemaining: null,
    };
    state = { ...state, stateVersion: state.stateVersion + 1, sequence: state.sequence + 1, publicState: "PAYMENT_UNKNOWN", activeSale: fixtureSale, cart: [] };
    await page.reload();
    await page.getByRole("heading", { name: "Contact Ten Kings" }).waitFor();
    assert.equal(await page.locator(".retry-action,.payment-continue-action").count(), 0, "unknown payment offers neither retry nor another payment");
    assert.equal(await page.getByText("Paid total", { exact: true }).count(), 0);
    await page.locator('a[href^="tel:"]').click();
    await page.getByText("Scan to call Ten Kings", { exact: true }).waitFor();
    assert.equal(new URL(page.url()).origin, address, "contact action must retain the appliance shell");
    if (screenshotDir) await page.screenshot({ path: resolve(screenshotDir, `vault-payment-unknown-${fixture.name}-${width}.png`), fullPage: true });

    state = { ...state, stateVersion: state.stateVersion + 1, sequence: state.sequence + 1, publicState: "PAID_RESET_COUNTDOWN", activeSale: { ...fixtureSale, state: "OPEN_COMMAND_TERMINAL", paymentState: "SETTLED", paidDoorIds: [firstDoorId], retryAvailable: true, resetSecondsRemaining: 30 } };
    await page.reload();
    const requestsBeforeRetry = retryRequests;
    await page.getByRole("button", { name: "OPEN DOORS", exact: true }).click();
    await page.locator(".retry-action").waitFor({ state: "detached" });
    assert.equal(retryRequests, requestsBeforeRetry + 1, "the paid retry tap sends exactly one intent");
    await page.getByRole("button", { name: "I GOT MY PACKS — DONE", exact: true }).click();
    await page.locator(".door-cell").last().waitFor();
    assert.deepEqual(errors, [], `browser runtime errors at ${width}`);
    console.log(`PASS ${fixture.name} portrait ${width}x${height} @${scale}: ${fixtureIds.length} doors, ${geometry.cellWidth}x${geometry.cellHeight} minimum CSS target, visible checkout/reachable final door, fixed positions and cutouts, label-to-ID selection, media/cart/idle focus, unknown-payment support, single paid retry and Done`);
    await context.close();
  }
  }
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
