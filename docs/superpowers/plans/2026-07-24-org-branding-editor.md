# Org Branding Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an org editor/admin upload their avatar + cover (with a crop step) from the admin web, stored in a new `org-images` bucket and written to `organizations.logo_url`/`banner_url` via scoped RLS; render those on the mobile org page (fallback to today's placeholders).

**Architecture:** One migration (bucket + storage RLS + column-scoped org update). Admin web: a `lib/org.ts` data layer + a pure `lib/cropImage.ts` canvas helper + a `CropUploader` component (react-easy-crop) + a Branding page on `/settings`. Mobile: `OrgAvatar`/`OrgBanner` gain an image branch, `OrgHeader` passes the URLs.

**Tech Stack:** Supabase Storage + RLS; React + React Router + TanStack Query + **react-easy-crop** + browser-image-compression (admin web, Vitest/jsdom); React Native + `@rn-primitives/avatar` (mobile, Jest).

## Global Constraints

- **Package manager** `pnpm@9.7.0`, Node `>=20`. Worktree: `.claude/worktrees/org-branding-editor`. Paths below are relative to the worktree root unless stated.
- **Three test surfaces:**
  - Admin web → **apps/web Vitest** (jsdom, `globals: true` — do NOT import `vi`/`it`/`expect`). Run from **`apps/web`**: `pnpm exec vitest run <pattern>`.
  - Mobile → **apps/mobile Jest**. Run from **`apps/mobile`**: `pnpm exec jest <pattern>`.
  - Edge `_shared` → root Vitest (unaffected by this feature; only re-run in final verification). From worktree root: `pnpm exec vitest run supabase/functions/_shared`.
- **The `lib/cropImage.ts` canvas helper is NOT unit-tested** (jsdom canvas is unreliable); it's kept thin, mocked in the page test, and verified by review — stated honestly, matching the repo's posture on untestable-in-CI code.
- **RLS is least-privilege:** the `organizations` update grant is scoped to `logo_url`, `banner_url` ONLY.
- **Storage path:** `org-images/{orgId}/{kind}-{uuid}.{ext}`, `kind` ∈ `avatar` | `cover`. Bucket is public-read.
- **No new mobile query** — `logo_url`/`banner_url` are already fetched by the org query; they were just never rendered.
- **TDD, DRY, YAGNI, frequent commits.** Deferred to merge (hosted): `supabase db push` (bucket + policies).

---

## Prerequisites (once, before Task 1)

- [ ] **P1: Install deps** — from the worktree root: `pnpm install`. Expected: completes.
- [ ] **P2: Dummy admin-web env** — the gitignored `apps/web/.env` is absent in a fresh worktree, and `lib/supabase.ts` calls `createClient` at load, so create `apps/web/.env`:
  ```
  VITE_SUPABASE_URL=https://test.supabase.co
  VITE_SUPABASE_ANON_KEY=test-anon-key
  ```
  Confirm it's gitignored: `git check-ignore apps/web/.env`.
- [ ] **P3: Baselines green** —
  - From `apps/web`: `pnpm exec vitest run` → passes.
  - From `apps/mobile`: `pnpm exec jest` → passes.

---

## Task 1: Migration — `org-images` bucket + org branding RLS

**Files:** Create `supabase/migrations/20260724130000_org_images.sql`

**Interfaces:** Produces the `org-images` public bucket with org-admin-scoped write policies, and a column-scoped `organizations` update policy for `logo_url`/`banner_url`.

> No automated test (SQL); apply deferred to merge.

- [ ] **Step 1: Create the migration**

```sql
-- Org branding: a public-read org-images bucket with org-admin-scoped writes
-- (objects at {org_id}/{kind}-{uuid}.{ext}; first path segment checked via
-- auth_can_admin_org), plus a column-scoped update on organizations so an
-- editor/admin can repoint their org's avatar/banner (logo_url/banner_url) only.

insert into storage.buckets (id, name, public)
values ('org-images', 'org-images', true)
on conflict (id) do nothing;

create policy "org_images_insert_org_admin" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'org-images' and auth_can_admin_org(((storage.foldername(name))[1])::uuid));

create policy "org_images_update_org_admin" on storage.objects
  for update to authenticated
  using (bucket_id = 'org-images' and auth_can_admin_org(((storage.foldername(name))[1])::uuid))
  with check (bucket_id = 'org-images' and auth_can_admin_org(((storage.foldername(name))[1])::uuid));

create policy "org_images_delete_org_admin" on storage.objects
  for delete to authenticated
  using (bucket_id = 'org-images' and auth_can_admin_org(((storage.foldername(name))[1])::uuid));

grant update (logo_url, banner_url) on organizations to authenticated;

create policy "organizations_update_branding_org_admin" on organizations
  for update using (auth_can_admin_org(id)) with check (auth_can_admin_org(id));
```

- [ ] **Step 2: Verify** — `cat` the file; confirm it matches and the filename sorts after `20260724120000_org_members.sql`.
- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260724130000_org_images.sql
git commit -m "feat(db): add org-images bucket and org branding update RLS"
```

---

## Task 2: `react-easy-crop` dependency + `lib/cropImage.ts` helper

**Files:** Modify `apps/web/package.json` (dep); Create `apps/web/src/lib/cropImage.ts`

**Interfaces:** Produces `PixelCrop` type and `getCroppedBlob(imageSrc, crop, type?): Promise<Blob>`. Adds `react-easy-crop` to apps/web.

> The helper isn't vitest-tested (jsdom canvas). Verification = it type-checks (`tsc`).

- [ ] **Step 1: Add the dependency**

Run (from `apps/web`): `pnpm add react-easy-crop`
Expected: `react-easy-crop` appears in `apps/web/package.json` dependencies; lockfile updates.

- [ ] **Step 2: Create the crop helper**

Create `apps/web/src/lib/cropImage.ts`:

```ts
export type PixelCrop = { x: number; y: number; width: number; height: number };

/** Draw the cropped region of `imageSrc` (an object URL) onto a canvas and return a Blob.
 *  Canvas isn't reliably available in jsdom, so this is intentionally not unit-tested;
 *  it's mocked in the Branding page test and verified by review. */
export async function getCroppedBlob(imageSrc: string, crop: PixelCrop, type = "image/png"): Promise<Blob> {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(crop.width));
  canvas.height = Math.max(1, Math.round(crop.height));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not supported in this browser.");
  ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not process the image."))), type)
  );
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load the image."));
    img.src = src;
  });
}
```

- [ ] **Step 3: Type-check**

Run (from `apps/web`): `pnpm exec tsc --noEmit`
Expected: clean (react-easy-crop types resolve; cropImage.ts type-checks).

- [ ] **Step 4: Commit**

```bash
git add apps/web/package.json apps/web/src/lib/cropImage.ts ../../pnpm-lock.yaml
git commit -m "feat(web): add react-easy-crop and a canvas crop helper"
```
*(If `pnpm-lock.yaml` is at the repo root, `git add` it from there; adjust the path so the lockfile change is committed.)*

---

## Task 3: Admin-web data layer — `lib/org.ts`

**Files:** Create `apps/web/src/lib/org.ts`; Test `apps/web/src/__tests__/org-hooks.test.tsx`

**Interfaces:** Produces `OrgBranding`, `OrgImageKind`, `useMyOrg(orgId?)`, `uploadOrgImage(orgId, blob, kind)`, `updateOrgBranding(orgId, patch)`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/__tests__/org-hooks.test.tsx`:

```tsx
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("browser-image-compression", () => ({ default: (f: File) => Promise.resolve(f) }));

const uploadMock = vi.fn().mockResolvedValue({ error: null });
const getPublicUrlMock = vi.fn(() => ({ data: { publicUrl: "https://cdn.test/org-images/a1/avatar-x.png" } }));
const updateEq = vi.fn().mockResolvedValue({ error: null });
const updateMock = vi.fn(() => ({ eq: updateEq }));
const singleMock = vi.fn().mockResolvedValue({ data: { id: "a1", name: "Muspo", logo_url: null, banner_url: null }, error: null });
vi.mock("../lib/supabase", () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ single: singleMock }) }), update: updateMock }),
    storage: { from: () => ({ upload: uploadMock, getPublicUrl: getPublicUrlMock }) },
  },
}));

import { useMyOrg, uploadOrgImage, updateOrgBranding } from "../lib/org";

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

it("useMyOrg returns the org branding row", async () => {
  const { result } = renderHook(() => useMyOrg("a1"), { wrapper: wrap() });
  await waitFor(() => expect(result.current.data).toBeTruthy());
  expect(result.current.data).toMatchObject({ id: "a1", name: "Muspo", logo_url: null });
});

it("uploadOrgImage uploads under {orgId}/{kind}-… and returns the URL", async () => {
  const blob = new File([new Uint8Array([1])], "a.png", { type: "image/png" });
  const url = await uploadOrgImage("a1", blob, "avatar");
  const path = uploadMock.mock.calls[0]![0] as string;
  expect(path).toMatch(/^a1\/avatar-.+\.png$/);
  expect(url).toBe("https://cdn.test/org-images/a1/avatar-x.png");
});

it("updateOrgBranding updates organizations by id and succeeds", async () => {
  const res = await updateOrgBranding("a1", { logo_url: "https://cdn/x.png" });
  expect(res.ok).toBe(true);
  expect(updateMock).toHaveBeenCalledWith({ logo_url: "https://cdn/x.png" });
  expect(updateEq).toHaveBeenCalledWith("id", "a1");
});

it("updateOrgBranding surfaces an error", async () => {
  updateEq.mockResolvedValueOnce({ error: { message: "denied" } });
  const res = await updateOrgBranding("a1", { banner_url: "u" });
  expect(res.ok).toBe(false);
  expect(res.error).toBe("denied");
});
```

- [ ] **Step 2: Run to verify it fails** — from `apps/web`: `pnpm exec vitest run org-hooks` → FAIL (`../lib/org` not found).

- [ ] **Step 3: Write the module**

Create `apps/web/src/lib/org.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { supabase } from "./supabase";
import { compressImage } from "./imageUpload";

export type OrgBranding = { id: string; name: string; logo_url: string | null; banner_url: string | null };
export type OrgImageKind = "avatar" | "cover";

const BUCKET = "org-images";
const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export function useMyOrg(orgId?: string) {
  return useQuery<OrgBranding | null>({
    queryKey: ["my-org", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const { data, error } = await supabase.from("organizations").select("id,name,logo_url,banner_url").eq("id", orgId!).single();
      if (error) throw error;
      return data as OrgBranding;
    },
  });
}

/** Compress `blob` and upload it under {orgId}/{kind}-{uuid}.{ext}; return the public URL. */
export async function uploadOrgImage(orgId: string, blob: Blob, kind: OrgImageKind): Promise<string> {
  const file = blob instanceof File ? blob : new File([blob], "image", { type: blob.type || "image/png" });
  const compressed = await compressImage(file);
  const ext = EXT[compressed.type] ?? "png";
  const path = `${orgId}/${kind}-${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, compressed, { contentType: compressed.type, upsert: false });
  if (error) throw new Error(error.message);
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function updateOrgBranding(orgId: string, patch: { logo_url?: string; banner_url?: string }): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("organizations").update(patch).eq("id", orgId);
  return error ? { ok: false, error: error.message } : { ok: true };
}
```

- [ ] **Step 4: Run to verify it passes** — from `apps/web`: `pnpm exec vitest run org-hooks` → PASS (4 tests).
- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/org.ts apps/web/src/__tests__/org-hooks.test.tsx
git commit -m "feat(web): add org branding data layer (useMyOrg, uploadOrgImage, updateOrgBranding)"
```

---

## Task 4: `CropUploader` + Branding page on `/settings`

**Files:** Create `apps/web/src/components/CropUploader.tsx`, `apps/web/src/routes/Settings.tsx`; Modify `apps/web/src/App.tsx`; Test `apps/web/src/__tests__/settings-branding.test.tsx`

**Interfaces:** Consumes `getCroppedBlob` (Task 2), `uploadOrgImage`/`updateOrgBranding`/`OrgImageKind` (Task 3), `useMyOrg` (Task 3), `useMyRoles`. Produces the `Settings` route; `/settings` renders the Branding page.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/__tests__/settings-branding.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

beforeEach(() => {
  (URL as unknown as { createObjectURL: (b: unknown) => string }).createObjectURL = () => "blob:mock";
});

vi.mock("../lib/roles", () => ({ useMyRoles: () => ({ data: { orgId: "a1" } }) }));
vi.mock("react-easy-crop", async () => {
  const React = await import("react");
  return { default: ({ onCropComplete }: { onCropComplete: (a: unknown, p: unknown) => void }) => {
    React.useEffect(() => { onCropComplete({}, { x: 0, y: 0, width: 100, height: 100 }); }, []);
    return React.createElement("div", { "data-testid": "cropper" });
  } };
});
vi.mock("../lib/cropImage", () => ({ getCroppedBlob: () => Promise.resolve(new Blob([""], { type: "image/png" })) }));
const uploadOrgImage = vi.fn(() => Promise.resolve("https://cdn/org-images/a1/avatar-x.png"));
const updateOrgBranding = vi.fn(() => Promise.resolve({ ok: true }));
vi.mock("../lib/org", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/org")>();
  return {
    ...actual,
    useMyOrg: () => ({ data: { id: "a1", name: "Muspo", logo_url: null, banner_url: null } }),
    uploadOrgImage: (...a: unknown[]) => uploadOrgImage(...a),
    updateOrgBranding: (...a: unknown[]) => updateOrgBranding(...a),
  };
});

import { Settings } from "../routes/Settings";

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

it("renders avatar and cover uploaders", () => {
  wrap(<Settings />);
  expect(screen.getByText("Avatar")).toBeInTheDocument();
  expect(screen.getByText("Cover photo")).toBeInTheDocument();
});

it("crops and saves an avatar upload", async () => {
  wrap(<Settings />);
  const file = new File([new Uint8Array([1])], "a.png", { type: "image/png" });
  fireEvent.change(screen.getByLabelText("Choose Avatar"), { target: { files: [file] } });
  expect(await screen.findByRole("dialog", { name: "Crop Avatar" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /save/i }));
  await waitFor(() => expect(uploadOrgImage).toHaveBeenCalledWith("a1", expect.anything(), "avatar"));
  await waitFor(() => expect(updateOrgBranding).toHaveBeenCalledWith("a1", { logo_url: "https://cdn/org-images/a1/avatar-x.png" }));
});
```

- [ ] **Step 2: Run to verify it fails** — from `apps/web`: `pnpm exec vitest run settings-branding` → FAIL (`../routes/Settings` not found).

- [ ] **Step 3: Write `CropUploader`**

Create `apps/web/src/components/CropUploader.tsx`:

```tsx
import { useCallback, useState, type ChangeEvent } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { getCroppedBlob } from "../lib/cropImage";
import { uploadOrgImage, updateOrgBranding, type OrgImageKind } from "../lib/org";

export function CropUploader({ orgId, kind, aspect, field, label, currentUrl, round, onSaved }: {
  orgId: string;
  kind: OrgImageKind;
  aspect: number;
  field: "logo_url" | "banner_url";
  label: string;
  currentUrl: string | null;
  round?: boolean;
  onSaved: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [pixels, setPixels] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) setSrc(URL.createObjectURL(file));
    e.target.value = "";
  };
  const onCropComplete = useCallback((_a: Area, px: Area) => setPixels(px), []);

  async function save() {
    if (!src || !pixels) return;
    setBusy(true);
    setError(null);
    try {
      const blob = await getCroppedBlob(src, pixels);
      const url = await uploadOrgImage(orgId, blob, kind);
      const res = await updateOrgBranding(orgId, { [field]: url });
      if (!res.ok) throw new Error(res.error);
      setSrc(null);
      onSaved();
    } catch (e) {
      setError((e as Error).message || "Upload failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>{label}</div>
      {currentUrl ? (
        <img src={currentUrl} alt={`Current ${label.toLowerCase()}`}
          style={{ width: round ? 72 : 234, height: round ? 72 : 90, borderRadius: round ? "50%" : 10, objectFit: "cover", display: "block", marginBottom: 10, border: "1px solid var(--hairline)" }} />
      ) : null}
      <label style={{ fontSize: 13, fontWeight: 600, color: "var(--primary)", cursor: "pointer" }}>
        Choose image
        <input type="file" accept="image/*" aria-label={`Choose ${label}`} onChange={onFile} style={{ display: "none" }} />
      </label>

      {src ? (
        <div role="dialog" aria-label={`Crop ${label}`}
          style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(0,0,0,.55)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
          <div style={{ position: "relative", width: 320, height: 320, background: "#000", borderRadius: 10, overflow: "hidden" }}>
            <Cropper image={src} crop={crop} zoom={zoom} aspect={aspect} cropShape={round ? "round" : "rect"}
              onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={onCropComplete} />
          </div>
          {error ? <div role="alert" style={{ color: "var(--danger)", fontSize: 13 }}>{error}</div> : null}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => { setSrc(null); setError(null); }} style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid var(--hairline)", background: "#fff", cursor: "pointer" }}>Cancel</button>
            <button onClick={save} disabled={busy} style={{ padding: "8px 16px", borderRadius: 8, border: "none", background: "var(--primary)", color: "#fff", fontWeight: 600, cursor: "pointer" }}>{busy ? "Saving…" : "Save"}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Write the Branding page**

Create `apps/web/src/routes/Settings.tsx`:

```tsx
import { useQueryClient } from "@tanstack/react-query";
import { useMyRoles } from "../lib/roles";
import { useMyOrg } from "../lib/org";
import { CropUploader } from "../components/CropUploader";

export function Settings() {
  const roles = useMyRoles();
  const orgId = roles.data?.orgId ?? undefined;
  const qc = useQueryClient();
  const org = useMyOrg(orgId);
  const refresh = () => qc.invalidateQueries({ queryKey: ["my-org", orgId] });

  return (
    <div style={{ maxWidth: 620 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Branding</h1>
      <p style={{ color: "var(--ink-muted)", fontSize: 14, marginBottom: 24 }}>Your organization's avatar and cover photo, shown on the mobile org page.</p>
      {orgId && org.data ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <CropUploader orgId={orgId} kind="avatar" aspect={1} field="logo_url" label="Avatar" round currentUrl={org.data.logo_url} onSaved={refresh} />
          <CropUploader orgId={orgId} kind="cover" aspect={390 / 150} field="banner_url" label="Cover photo" currentUrl={org.data.banner_url} onSaved={refresh} />
        </div>
      ) : (
        <div style={{ color: "var(--ink-muted)" }}>Loading…</div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Wire the route**

In `apps/web/src/App.tsx`: add `import { Settings } from "./routes/Settings";` and replace
```tsx
            <Route path="settings" element={<Placeholder title="Settings" />} />
```
with
```tsx
            <Route path="settings" element={<Settings />} />
```
Leave the `Placeholder` import (other routes still use it).

- [ ] **Step 6: Run to verify it passes** — from `apps/web`: `pnpm exec vitest run settings-branding` → PASS (2 tests).
- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/CropUploader.tsx apps/web/src/routes/Settings.tsx apps/web/src/App.tsx apps/web/src/__tests__/settings-branding.test.tsx
git commit -m "feat(web): add org branding page with cropped avatar/cover upload"
```

---

## Task 5: Mobile rendering — `OrgAvatar` / `OrgBanner` / `OrgHeader`

**Files:** Modify `apps/mobile/components/OrgAvatar.tsx`, `apps/mobile/components/OrgBanner.tsx`, `apps/mobile/components/OrgHeader.tsx`; Test `apps/mobile/__tests__/org-branding.test.tsx`

**Interfaces:** `OrgAvatar` gains `logoUrl?`, `OrgBanner` gains `bannerUrl?`; `OrgHeader` passes `org.logo_url`/`org.banner_url` through.

- [ ] **Step 1: Write the failing test**

Create `apps/mobile/__tests__/org-branding.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react-native";
import { OrgAvatar } from "../components/OrgAvatar";
import { OrgBanner } from "../components/OrgBanner";

describe("OrgAvatar", () => {
  it("shows initials as the fallback with no logo", () => {
    render(<OrgAvatar name="Muspo Trail" color="#159A55" size={48} />);
    expect(screen.getByText("MT")).toBeOnTheScreen();
  });
  it("still renders (with the initials fallback) when a logo URL is provided", () => {
    render(<OrgAvatar name="Muspo Trail" logoUrl="https://cdn/x.png" size={48} />);
    expect(screen.getByText("MT")).toBeOnTheScreen();
  });
});

describe("OrgBanner", () => {
  it("renders the cover image when bannerUrl is set", () => {
    render(<OrgBanner height={170} bannerUrl="https://cdn/b.png" />);
    expect(screen.getByLabelText("Organization cover photo")).toBeOnTheScreen();
  });
  it("renders the fallback (no cover image) when bannerUrl is absent", () => {
    render(<OrgBanner height={170} />);
    expect(screen.queryByLabelText("Organization cover photo")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails** — from `apps/mobile`: `pnpm exec jest org-branding` → FAIL (`bannerUrl` label not found / `logoUrl` prop absent).

- [ ] **Step 3: Update `OrgAvatar`**

In `apps/mobile/components/OrgAvatar.tsx`: import `AvatarImage`, add the `logoUrl` prop, and render the image branch. Replace the import line and the component:

```tsx
import { Text } from "react-native";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
```
```tsx
export function OrgAvatar({ name, color, size = 24, radius, logoUrl }: {
  name?: string | null; color?: string | null; size?: number; radius?: number; logoUrl?: string | null;
}) {
  const borderRadius = radius ?? size / 2;
  return (
    <Avatar alt={name ? `${name} logo` : "Organization logo"} style={{ width: size, height: size, borderRadius }}>
      {logoUrl ? <AvatarImage source={{ uri: logoUrl }} style={{ borderRadius }} /> : null}
      <AvatarFallback style={{ backgroundColor: color || "#159A55" /* trail-green brand default */, borderRadius }}>
        <Text style={{ color: "#fff", fontWeight: "700", fontSize: Math.max(9, Math.round(size * 0.4)) }}>{initials(name)}</Text>
      </AvatarFallback>
    </Avatar>
  );
}
```
(Keep the existing `initials` export and comment.)

- [ ] **Step 4: Update `OrgBanner`**

Replace `apps/mobile/components/OrgBanner.tsx` with:

```tsx
import { View, Image } from "react-native";
import Svg, { Rect, Polygon, Polyline } from "react-native-svg";

// Org page header banner. Renders the uploaded cover photo when present; otherwise the
// dark-green ridge fallback (matches the design's orgBannerSvg — forest / tint / primary).
export function OrgBanner({ height, bannerUrl }: { height: number; bannerUrl?: string | null }) {
  if (bannerUrl) {
    return (
      <View className="overflow-hidden bg-forest" style={{ height }}>
        <Image source={{ uri: bannerUrl }} resizeMode="cover" style={{ width: "100%", height }} accessibilityLabel="Organization cover photo" />
      </View>
    );
  }
  return (
    <View className="overflow-hidden bg-forest" style={{ height }}>
      <Svg width="100%" height="100%" viewBox="0 0 390 150" preserveAspectRatio="none">
        <Rect width={390} height={150} fill="#0F2A20" />
        <Polygon points="0,150 0,96 90,44 180,100 270,54 340,92 390,66 390,150" fill="#153A2C" />
        <Polyline points="0,100 90,50 180,104 270,58 340,96 390,70" fill="none" stroke="#159A55" strokeWidth={2} strokeOpacity={0.6} />
      </Svg>
    </View>
  );
}
```

- [ ] **Step 5: Pass the URLs in `OrgHeader`**

In `apps/mobile/components/OrgHeader.tsx`, update the two renders:
```tsx
      <OrgBanner height={170} bannerUrl={org.banner_url} />
```
```tsx
          <OrgAvatar name={org.name} color={org.brand_color} size={84} radius={22} logoUrl={org.logo_url} />
```
(`org` already carries `logo_url`/`banner_url` from the org query.)

- [ ] **Step 6: Run to verify it passes** — from `apps/mobile`: `pnpm exec jest org-branding` → PASS (4 tests). Then `pnpm exec jest OrgHeader org-page` to confirm any existing org-header/page test still passes with the new props (if such a test exists; otherwise skip).
- [ ] **Step 7: Commit**

```bash
git add apps/mobile/components/OrgAvatar.tsx apps/mobile/components/OrgBanner.tsx apps/mobile/components/OrgHeader.tsx apps/mobile/__tests__/org-branding.test.tsx
git commit -m "feat(mobile): render uploaded org avatar and cover, fallback to placeholders"
```

---

## Task 6: Full verification

**Files:** none.

- [ ] **Step 1: Admin-web suite + typecheck** — from `apps/web`: `pnpm exec vitest run` (all green, incl. `org-hooks`, `settings-branding`), then `pnpm exec tsc --noEmit` (clean).
- [ ] **Step 2: Mobile suite** — from `apps/mobile`: `pnpm exec jest` (all green, incl. `org-branding`).
- [ ] **Step 3: Edge `_shared` unaffected** — from worktree root: `pnpm exec vitest run supabase/functions/_shared` (still green).

> No commit — verification only.

---

## Self-Review (completed while writing)

**Spec coverage:** §3 bucket + storage RLS → Task 1; §4 org update RLS → Task 1; §5 admin-web (data layer, crop helper, CropUploader, Branding page, route) → Tasks 2-4; §6 mobile rendering → Task 5; §7 testing → Tasks 3/4/5/6 (crop helper explicitly not unit-tested, mocked in Task 4). 

**Placeholder scan:** none — every step has full code or an exact command. `cropImage.ts` is intentionally not vitest-tested (documented, mocked in Task 4).

**Type consistency:** `OrgBranding`/`OrgImageKind` (Task 3) are consumed unchanged in Task 4; `getCroppedBlob(imageSrc, PixelCrop)` (Task 2) matches its call in `CropUploader`; `uploadOrgImage(orgId, blob, kind)` / `updateOrgBranding(orgId, {logo_url|banner_url})` signatures match the page's calls and the test assertions; the mobile `logoUrl`/`bannerUrl` props (Task 5) match what `OrgHeader` passes.
```
