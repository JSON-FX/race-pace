import { describe, it, expect } from "vitest";
import { isOriginAllowed, buildCorsHeaders } from "./cors";

describe("isOriginAllowed", () => {
  const allowed = ["http://localhost:3000", "https://racepace.ph", "*.vercel.app"];

  it("accepts an exact match", () => {
    expect(isOriginAllowed("https://racepace.ph", allowed)).toBe(true);
    expect(isOriginAllowed("http://localhost:3000", allowed)).toBe(true);
  });

  it("rejects an origin that is not listed", () => {
    expect(isOriginAllowed("https://evil.example", allowed)).toBe(false);
  });

  it("rejects a null origin", () => {
    expect(isOriginAllowed(null, allowed)).toBe(false);
  });

  // Vercel preview deploys get a fresh subdomain per branch, so an exact
  // allowlist can never cover them.
  it("accepts a subdomain via a *. wildcard entry", () => {
    expect(isOriginAllowed("https://site-git-abc-jayson.vercel.app", allowed)).toBe(true);
  });

  it("does not let a wildcard match a lookalike suffix", () => {
    expect(isOriginAllowed("https://notvercel.app", allowed)).toBe(false);
    expect(isOriginAllowed("https://evil-vercel.app", allowed)).toBe(false);
  });

  // "*.vercel.app" must not authorize the bare apex.
  it("does not let a wildcard match the apex domain", () => {
    expect(isOriginAllowed("https://vercel.app", allowed)).toBe(false);
  });
});

describe("buildCorsHeaders", () => {
  const allowed = ["https://racepace.ph"];

  it("echoes an allowed origin and always varies on Origin", () => {
    const h = buildCorsHeaders("https://racepace.ph", allowed);
    expect(h["Access-Control-Allow-Origin"]).toBe("https://racepace.ph");
    expect(h["Vary"]).toBe("Origin");
  });

  it("omits the allow-origin header entirely for a disallowed origin", () => {
    const h = buildCorsHeaders("https://evil.example", allowed);
    expect(h["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("allows the headers supabase-js actually sends", () => {
    const h = buildCorsHeaders("https://racepace.ph", allowed);
    expect(h["Access-Control-Allow-Headers"]).toContain("authorization");
    expect(h["Access-Control-Allow-Headers"]).toContain("apikey");
    expect(h["Access-Control-Allow-Headers"]).toContain("content-type");
  });
});
