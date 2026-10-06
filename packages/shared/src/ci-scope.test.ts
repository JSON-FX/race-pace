import { describe, expect, it } from "vitest";
// @ts-expect-error The scope CLI is a dependency-free JavaScript module.
import { classifyValidation } from "../../../scripts/ci-scope.mjs";

const full = { site: true, web: true, shared: true, backend: true };

describe("validation scopes", () => {
  it("validates an admin UI change without starting the backend", () => {
    expect(classifyValidation(["apps/web/app/(admin)/reservations/page.tsx"]))
      .toEqual({ site: false, web: true, shared: true, backend: false });
  });

  it("validates runner UI and its source audit independently", () => {
    expect(classifyValidation(["apps/site/components/event-card.tsx"]))
      .toEqual({ site: true, web: false, shared: true, backend: false });
  });

  it.each([
    "apps/site/lib/payment.ts", "apps/site/lib/server/proof-verification.ts",
    "apps/site/app/api/internal/prescreening-proof/route.ts", "apps/site/middleware.ts",
    "apps/site/package.json", "apps/site/next.config.ts",
  ])("retains backend coverage for the runner dependency %s", (path) => {
    expect(classifyValidation([path]).backend).toBe(true);
  });

  it.each([
    "pnpm-lock.yaml", "package.json", "pnpm-workspace.yaml", "tsconfig.json",
    "vitest.config.ts", ".github/workflows/ci.yml", "scripts/ci-scope.mjs",
    "packages/shared/src/index.ts", "supabase/migrations/20261006000000_example.sql",
    "supabase/functions/_shared/fee.ts", "test/env.ts", "new-unknown/file.ts",
    "apps/mobile/App.tsx", "docs/config.json", "../outside", "/absolute/file",
  ])("fails conservatively to full checks for %s", (path) => {
    expect(classifyValidation([path])).toEqual(full);
  });

  it("validates both consumers when shared UI changes", () => {
    expect(classifyValidation(["packages/ui/src/ui/button.tsx"]))
      .toEqual({ site: true, web: true, shared: true, backend: false });
  });

  it.each(["docs/specs/fieldnotes-components-audit.json", "docs/specs/fieldnotes-component-exceptions.json"])
    ("does not skip the audit input %s as documentation", (path) => {
      expect(classifyValidation([path])).toEqual({ site: false, web: false, shared: true, backend: false });
    });

  it("combines scopes, including both sides of a renamed file", () => {
    expect(classifyValidation(["apps/web/components/card.tsx", "apps/site/components/card.tsx"]))
      .toEqual({ site: true, web: true, shared: true, backend: false });
  });

  it("skips only known prose changes", () => {
    expect(classifyValidation(["docs/operations/release-workflow.md", "README.md", "AGENTS.md"]))
      .toEqual({ site: false, web: false, shared: false, backend: false });
  });
});
