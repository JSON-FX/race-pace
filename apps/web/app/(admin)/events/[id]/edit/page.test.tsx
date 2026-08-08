import { render, screen } from "@testing-library/react";
import type { EditorData } from "@/lib/queries/event-editor";

const getEventForEditor = vi.fn();
const getMyRoles = vi.fn();
const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
const redirect = vi.fn((path: string) => {
  throw new Error(`NEXT_REDIRECT:${path}`);
});

vi.mock("@/lib/queries/event-editor", () => ({ getEventForEditor: (id: string) => getEventForEditor(id) }));
// requireOrgId is trivial (`roles?.orgId ?? null`) and pure — reimplemented
// here rather than spreading the real module's exports, so this test never
// needs a real Supabase-backed getMyRoles import.
vi.mock("@/lib/queries/roles", () => ({
  getMyRoles: () => getMyRoles(),
  requireOrgId: (roles: { orgId: string | null } | null) => roles?.orgId ?? null,
}));
vi.mock("next/navigation", () => ({ notFound: () => notFound(), redirect: (path: string) => redirect(path) }));
// The full editor form isn't the concern of this test — stub it so a render
// only fails on this page's own authorization logic.
vi.mock("../../event-editor-form", () => ({ EventEditorForm: () => <div data-testid="editor-form-stub" /> }));

import EditEventPage from "./page";

function editorData(orgId: string): EditorData {
  return {
    event: {
      id: "e1", org_id: orgId, name: "Apo", city_psgc_code: null, region_name: null, province_name: null,
      city_name: null, venue: null, event_date: null, end_date: null, flag_off: null, status: "open",
      registration_closes_at: null, kit_edit_closes_at: null,
      discipline: "trail", elevation_gain_m: null, cutoff_hours: null, start_lat: null, start_lng: null,
      finish_lat: null, finish_lng: null, route: null, description: null, hero_image_url: null,
      gallery: [], schedule: [], inclusions: [],
    },
    categories: [],
    addons: [],
  };
}
function roles(
  overrides: Partial<{ isSuperAdmin: boolean; orgId: string | null; capabilities: string[] }> = {},
) {
  return {
    role: "admin", isSuperAdmin: false, isAdmin: true, isOrgAdmin: true, orgId: "a1",
    capabilities: ["manage_org"],
    ...overrides,
  };
}

beforeEach(() => {
  getEventForEditor.mockReset();
  getMyRoles.mockReset();
  notFound.mockClear();
  redirect.mockClear();
});

it("renders the editor for an event in the caller's own org", async () => {
  getEventForEditor.mockResolvedValue(editorData("a1"));
  getMyRoles.mockResolvedValue(roles({ orgId: "a1" }));
  render(await EditEventPage({ params: Promise.resolve({ id: "e1" }) }));
  expect(await screen.findByTestId("editor-form-stub")).toBeInTheDocument();
  expect(notFound).not.toHaveBeenCalled();
});

// getEventForEditor has no org filter — events_read_published RLS admits any
// authenticated caller for a non-draft event. This page-level check is the
// ONLY thing stopping an editor of org A from opening (and, until Save,
// silently seeing) org B's event by pasting its id into the URL.
it("404s when the event belongs to a different org than the caller's resolved org", async () => {
  getEventForEditor.mockResolvedValue(editorData("org-b"));
  getMyRoles.mockResolvedValue(roles({ orgId: "a1" }));
  await expect(EditEventPage({ params: Promise.resolve({ id: "e1" }) })).rejects.toThrow("NEXT_NOT_FOUND");
  expect(notFound).toHaveBeenCalled();
});

it("does not 404 a super_admin regardless of their resolved orgId", async () => {
  getEventForEditor.mockResolvedValue(editorData("org-b"));
  getMyRoles.mockResolvedValue(roles({ isSuperAdmin: true, orgId: "a1" }));
  render(await EditEventPage({ params: Promise.resolve({ id: "e1" }) }));
  expect(await screen.findByTestId("editor-form-stub")).toBeInTheDocument();
  expect(notFound).not.toHaveBeenCalled();
});

it("404s a caller with no resolved org (super_admin edge case aside) rather than rendering", async () => {
  getEventForEditor.mockResolvedValue(editorData("a1"));
  getMyRoles.mockResolvedValue(roles({ orgId: null }));
  await expect(EditEventPage({ params: Promise.resolve({ id: "e1" }) })).rejects.toThrow("NEXT_NOT_FOUND");
});

// Fix 2 regression test: this page asserted no capability before this fix,
// so a marshal (check_in only, no manage_org) reached a fully rendered
// editor past the (admin) layout's "some capability" gate. redirect(), not
// notFound() — this is not the same "event doesn't exist for you" signal as
// the org-mismatch check above. getEventForEditor is still fetched (it runs
// inside the same Promise.all as getMyRoles, before either result is
// inspected) — only what the page DOES with the result changes.
it("redirects a marshal to /no-access rather than rendering the editor", async () => {
  getEventForEditor.mockResolvedValue(editorData("a1"));
  getMyRoles.mockResolvedValue(roles({ capabilities: ["check_in"] }));
  await expect(EditEventPage({ params: Promise.resolve({ id: "e1" }) })).rejects.toThrow("NEXT_REDIRECT:/no-access");
  expect(notFound).not.toHaveBeenCalled();
});
