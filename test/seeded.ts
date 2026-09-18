import { createClient } from "@supabase/supabase-js";
import { loadEnv } from "./env";

/**
 * Fixture ids resolved from whatever `seed.sql` actually created.
 *
 * These used to be hardcoded in each test file as
 * `const RWP = "00000000-0000-0000-0000-0000000000a1"` and friends. Commit
 * 35a8122 rewrote seed.sql's id scheme (orgs became `…00000a001`/`…00000a002`)
 * and every one of those constants silently became a dangling reference: the
 * service-role inserts that used them failed the foreign key, `.single()`
 * returned null, and the next line died on `Cannot read properties of null`.
 * That took out 34 tests across 9 files, and left the RLS suite providing no
 * safety net at all for database changes — which is exactly when you most want
 * it.
 *
 * Looking the ids up instead of restating them means the next seed rewrite
 * cannot do this again. Categories in particular now get random uuids, so
 * there is no constant that COULD be written for them.
 *
 * Ordering is by id everywhere so the same row is chosen on every run —
 * an arbitrary-but-stable pick, not a lucky one.
 */
export type SeededIds = {
  /** An organization that owns events. (Tests previously called this RWP.) */
  ORG_A: string;
  /** A DIFFERENT organization — the cross-org isolation tests depend on these
   *  two never being the same. (Previously APO.) */
  ORG_B: string;
  /** An event belonging to ORG_A. (Previously E1.) */
  EVENT_A: string;
  /** Published organizer waiver selected for EVENT_A. */
  WAIVER_A: string;
  /** A category belonging to EVENT_A. (Previously C4.) */
  CATEGORY_A: string;
  /** A SECOND event in ORG_A, for suites that need their rows isolated from
   *  whatever other tests wrote against EVENT_A. (Previously EVT.) */
  EVENT_A2: string;
  /** Published organizer waiver selected for EVENT_A2. */
  WAIVER_A2: string;
  /** A category belonging to EVENT_A2 — must pair with EVENT_A2, not EVENT_A,
   *  or the registration insert violates the event/category relationship. */
  CATEGORY_A2: string;
};

let cached: SeededIds | null = null;

export async function seededIds(): Promise<SeededIds> {
  if (cached) return cached;

  const { url, serviceKey } = loadEnv();
  const svc = createClient(url, serviceKey, { auth: { persistSession: false } });

  const orgs = await svc.from("organizations").select("id").order("id");
  if (orgs.error) throw orgs.error;
  if ((orgs.data?.length ?? 0) < 2) {
    throw new Error(
      `Expected at least 2 seeded organizations, found ${orgs.data?.length ?? 0}. ` +
        "Run: pnpm exec supabase db reset",
    );
  }
  const ORG_A = orgs.data![0].id as string;
  const ORG_B = orgs.data![1].id as string;

  // `open` only: a closed or almost_full event makes registrations-checkout
  // reject with a status these suites read as an unexplained failure. And only
  // events that actually have a category are usable — every registration insert
  // here needs a valid (event_id, category_id) pair.
  const events = await svc
    .from("events")
    .select("id, waiver_version_id, categories(id)")
    .eq("org_id", ORG_A)
    .eq("status", "open")
    .order("id");
  if (events.error) throw events.error;

  type Ev = { id: string; waiver_version_id: string | null; categories: { id: string }[] };
  const usable = (events.data ?? []).filter(
    (e) => ((e as Ev).categories?.length ?? 0) > 0,
  ) as unknown as Ev[];

  // Aggregate tests now filter by their own per-run search stamp. Requiring an
  // empty event exhausted the seed after repeated walkthroughs and failed runs.
  // Still choose a distinct event, without deleting existing local QA data.
  if (usable.length < 2) {
    throw new Error(
      `Expected two open seeded events with categories (found ${usable.length}) in org ${ORG_A}.`,
    );
  }
  if (!usable[0].waiver_version_id || !usable[1].waiver_version_id) {
    throw new Error("Seeded checkout events need published organizer waivers. Run: pnpm exec supabase db reset");
  }

  const pickCategory = (e: Ev) =>
    [...e.categories].sort((a, b) => a.id.localeCompare(b.id))[0].id;

  cached = {
    ORG_A,
    ORG_B,
    EVENT_A: usable[0].id,
    WAIVER_A: usable[0].waiver_version_id,
    CATEGORY_A: pickCategory(usable[0]),
    EVENT_A2: usable[1].id,
    WAIVER_A2: usable[1].waiver_version_id,
    CATEGORY_A2: pickCategory(usable[1]),
  };
  return cached;
}
