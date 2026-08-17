import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");
const app = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
const client = readFileSync(resolve(process.cwd(), "src/api/VaultApiClient.ts"), "utf8");
const header = readFileSync(resolve(process.cwd(), "src/components/BrandHeader.tsx"), "utf8");

describe("touchscreen and trust-boundary static invariants", () => {
  it("contains 44px-or-larger touch targets, sticky map headers, portrait proxies, and reduced-motion behavior", () => {
    expect(css).toMatch(/min-height:\s*48px/);
    expect(css).toMatch(/\.door-map-header\s*\{[^}]*position:\s*sticky/s);
    expect(css).toMatch(/@media \(min-width: 720px\) and \(min-height: 1280px\)/);
    expect(css).toMatch(/@media \(min-width: 1080px\) and \(min-height: 1800px\)/);
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
    expect(css).toMatch(/forced-colors:\s*active/);
  });

  it("does not access serial, USB, environment secrets, or cardholder data", () => {
    expect(app).not.toMatch(/navigator\.(serial|usb)/);
    expect(client).not.toMatch(/navigator\.(serial|usb)/);
    expect(`${app}\n${client}`).not.toMatch(/process\.env|VITE_.*(?:SECRET|TOKEN|KEY)|localStorage.*(?:pin|secret|token)/i);
    expect(client).not.toMatch(/provider-callback/);
  });

  it("uses the locked ten-tap invisible-corner staff entry contract", () => {
    expect(app).toMatch(/now - time < 6000/);
    expect(app).toMatch(/length >= 10/);
    expect(app).toMatch(/resetOnOutsideTap/);
    expect(header).toMatch(/service-hot-corner/);
    expect(css).toMatch(/\.service-hot-corner[^}]*opacity:\s*0/);
  });

  it("has one fetch boundary and no fetch calls elsewhere in the kiosk source", () => {
    expect(client.match(/\bfetch\(/g)).toHaveLength(1);
    expect(app).not.toMatch(/\bfetch\(/);
  });
});
