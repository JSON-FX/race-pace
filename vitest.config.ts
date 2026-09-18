import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts", "supabase/**/*.test.ts"],
    environment: "node",
    // Integration files share seeded slots and some run database-wide backfills.
    // Parallel files can mutate another test's financial snapshot mid-assertion.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
