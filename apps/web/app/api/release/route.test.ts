import { afterEach, expect, it, vi } from "vitest";
import { dynamic, GET } from "./route";

afterEach(() => vi.unstubAllEnvs());

it("publishes only build identity and the public backend project", async () => {
  vi.stubEnv("NEXT_PUBLIC_RELEASE_SHA", "a".repeat(40));
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://pepbmqomiailnnvvwupz.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "never-public");
  expect(dynamic).toBe("force-static");
  expect(await GET().json()).toEqual({ app: "web", sha: "a".repeat(40), supabaseProject: "pepbmqomiailnnvvwupz" });
});

it("does not invent release evidence in an ordinary local build", async () => {
  vi.stubEnv("NEXT_PUBLIC_RELEASE_SHA", undefined);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", undefined);
  expect(await GET().json()).toEqual({ app: "web", sha: null, supabaseProject: null });
});
