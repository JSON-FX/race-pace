import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ roles: vi.fn(), client: vi.fn(), list: vi.fn(), upsert: vi.fn(), saved: vi.fn(), lookup: vi.fn(), sign: vi.fn(), refresh: vi.fn(), table: vi.fn(), bucket: vi.fn() }));
vi.mock("@/lib/queries/roles", () => ({ getMyRoles: mocks.roles }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
import { guidePlaybackAction, saveGuideAction } from "./guides";
import { GUIDE_BUCKET, GUIDE_URL_SECONDS } from "@/lib/guides";

const id = "11111111-1111-4111-8111-111111111111";
const upload = "22222222-2222-4222-8222-222222222222";
const input = { id, title: "  Create an event  ", description: "  Prepare categories.  ", topic: "Events", duration_seconds: 60,
  storage_path: `${id}/${upload}.mp4`, thumbnail_path: `${id}/${upload}.jpg`, is_published: true };

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.roles.mockResolvedValue({ isSuperAdmin: true, isOrgAdmin: true });
  mocks.list.mockImplementation(async (_folder: string, options: { search: string }) => ({ data: [{ name: options.search }], error: null }));
  mocks.saved.mockResolvedValue({ data: [{ id }], error: null });
  mocks.upsert.mockReturnValue({ select: mocks.saved });
  mocks.lookup.mockResolvedValue({ data: { storage_path: input.storage_path }, error: null });
  mocks.sign.mockResolvedValue({ data: { signedUrl: "https://storage.example/signed-video" }, error: null });
  mocks.bucket.mockReturnValue({ list: mocks.list, createSignedUrl: mocks.sign });
  mocks.table.mockReturnValue({ upsert: mocks.upsert, select: () => ({ eq: () => ({ maybeSingle: mocks.lookup }) }) });
  mocks.client.mockResolvedValue({ from: mocks.table, storage: { from: mocks.bucket } });
});
afterEach(() => vi.restoreAllMocks());

describe("saveGuideAction", () => {
  it.each([{ isSuperAdmin: false, isOrgAdmin: true }, { isSuperAdmin: false, isOrgAdmin: false }, null])("denies saving for non-super-admin roles %j before storage access", async roles => {
    mocks.roles.mockResolvedValue(roles);
    expect(await saveGuideAction(input)).toEqual({ ok: false, error: "Only super admins can save guides." });
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it("validates metadata before creating a storage or database client", async () => {
    expect(await saveGuideAction({ ...input, title: " " })).toEqual({ ok: false, error: "Add a title." });
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it("requires the exact uploaded video object, not a search substring match", async () => {
    mocks.list.mockResolvedValue({ data: [{ name: `backup-${upload}.mp4` }], error: null });
    expect(await saveGuideAction(input)).toEqual({ ok: false, error: "The uploaded file could not be found. Try again." });
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("also requires an optional thumbnail object before saving", async () => {
    mocks.list.mockResolvedValueOnce({ data: [{ name: `${upload}.mp4` }], error: null }).mockResolvedValueOnce({ data: [], error: null });
    expect((await saveGuideAction(input)).ok).toBe(false);
    expect(mocks.list).toHaveBeenNthCalledWith(2, id, { search: `${upload}.jpg`, limit: 10 });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("sanitizes storage failures and does not write metadata", async () => {
    mocks.list.mockResolvedValue({ data: null, error: { message: "private storage detail" } });
    const result = await saveGuideAction(input);
    expect(result.error).toMatch(/uploaded file could not be found/);
    expect(result.error).not.toContain("private storage detail");
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
  it("saves normalized metadata only after verifying uploaded objects and a returned row", async () => {
    expect(await saveGuideAction(input)).toEqual({ ok: true });
    expect(mocks.bucket).toHaveBeenCalledWith(GUIDE_BUCKET);
    expect(mocks.table).toHaveBeenCalledWith("guide_videos");
    expect(mocks.upsert).toHaveBeenCalledWith({ ...input, title: "Create an event", description: "Prepare categories.", updated_at: expect.any(String) });
    expect(mocks.saved).toHaveBeenCalledWith("id");
    expect(mocks.refresh).toHaveBeenCalledWith("/guide");
  });
  it("allows a draft without a thumbnail and verifies only its video", async () => {
    expect(await saveGuideAction({ ...input, thumbnail_path: null, is_published: false })).toEqual({ ok: true });
    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ thumbnail_path: null, is_published: false }));
  });
  it.each([
    { data: [], error: null },
    { data: null, error: { message: "private database detail" } },
  ])("does not report success or revalidate an unconfirmed write %j", async outcome => {
    mocks.saved.mockResolvedValue(outcome);
    expect(await saveGuideAction(input)).toEqual({ ok: false, error: "Guide could not be saved. Your upload is ready; try saving again." });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

describe("guidePlaybackAction", () => {
  it.each([{ isOrgAdmin: false, isSuperAdmin: false }, null])("denies non-admin playback before touching storage %j", async roles => {
    mocks.roles.mockResolvedValue(roles);
    expect(await guidePlaybackAction(id)).toEqual({ error: "You don’t have access to this guide." });
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it("rejects a malformed guide identifier before database lookup", async () => {
    expect(await guidePlaybackAction("../video")).toEqual({ error: "You don’t have access to this guide." });
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it.each([{ data: null, error: null }, { data: null, error: { message: "private row detail" } }])("reports an unavailable guide without signing %j", async outcome => {
    mocks.lookup.mockResolvedValue(outcome);
    expect(await guidePlaybackAction(id)).toEqual({ error: "This guide is no longer available. Refresh the library." });
    expect(mocks.sign).not.toHaveBeenCalled();
  });
  it("sanitizes signing failures", async () => {
    mocks.sign.mockResolvedValue({ data: null, error: { message: "private signing detail" } });
    expect(await guidePlaybackAction(id)).toEqual({ error: "Video couldn’t load. Check your connection, then try again." });
  });
  it("signs the RLS-visible object's path for the bounded playback lifetime", async () => {
    mocks.roles.mockResolvedValue({ isOrgAdmin: true, isSuperAdmin: false });
    expect(await guidePlaybackAction(id)).toEqual({ url: "https://storage.example/signed-video" });
    expect(mocks.sign).toHaveBeenCalledWith(input.storage_path, GUIDE_URL_SECONDS);
    expect(mocks.bucket).toHaveBeenCalledWith(GUIDE_BUCKET);
  });
});
