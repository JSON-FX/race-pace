import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { uploadGuideVideo } from "./guide-upload";

const mocks = vi.hoisted(() => ({ session: vi.fn(), thumbnail: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { getSession: mocks.session }, storage: { from: () => ({ upload: mocks.thumbnail }) } }) }));

class UploadRequest {
  static latest: UploadRequest;
  upload = { onprogress: null as ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 200;
  open = vi.fn();
  setRequestHeader = vi.fn();
  send = vi.fn();
  constructor() { UploadRequest.latest = this; }
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ data: { session: { access_token: "fixture-session" } }, error: null });
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54721");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "fixture-anon");
  vi.stubGlobal("XMLHttpRequest", UploadRequest);
  vi.stubGlobal("URL", { createObjectURL: () => "blob:fixture", revokeObjectURL: vi.fn() });
  const create = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((name, options) => {
    const element = create(name, options);
    if (name === "video") {
      Object.defineProperty(element, "duration", { value: 90 });
      Object.defineProperty(element, "src", { set: () => queueMicrotask(() => element.dispatchEvent(new Event("loadedmetadata"))) });
      Object.defineProperty(element, "currentTime", { set: () => queueMicrotask(() => element.dispatchEvent(new Event("seeked"))) });
      (element as HTMLVideoElement).load = vi.fn();
    }
    if (name === "canvas") (element as HTMLCanvasElement).getContext = vi.fn().mockReturnValue(null);
    return element;
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

async function start() {
  const phase = vi.fn();
  const progress = vi.fn();
  const file = new File(["video"], "guide.mp4", { type: "video/mp4" });
  const result = uploadGuideVideo("guide-id", file, phase, progress);
  // Metadata inspection and session retrieval precede the network request.
  await vi.waitFor(() => expect(UploadRequest.latest?.send).toHaveBeenCalled());
  return { phase, progress, file, result, request: UploadRequest.latest };
}

it("reports bytes sent, uses the authenticated immutable multipart protocol, and waits for success", async () => {
  const { phase, progress, file, result, request } = await start();
  expect(request.open).toHaveBeenCalledWith("POST", expect.stringMatching(/^http:\/\/127.0.0.1:54721\/storage\/v1\/object\/guide-videos\/guide-id\/.+\.mp4$/));
  expect(request.setRequestHeader).toHaveBeenCalledWith("Authorization", "Bearer fixture-session");
  expect(request.setRequestHeader).toHaveBeenCalledWith("apikey", "fixture-anon");
  expect(request.setRequestHeader).toHaveBeenCalledWith("x-upsert", "false");
  const body = request.send.mock.calls[0][0] as FormData;
  expect(body.get("cacheControl")).toBe("3600");
  expect(body.get("")).toBe(file);
  expect(progress).toHaveBeenLastCalledWith(0);
  request.upload.onprogress?.({ lengthComputable: true, loaded: 25, total: 100 });
  expect(progress).toHaveBeenLastCalledWith(25);
  request.upload.onprogress?.({ lengthComputable: false, loaded: 50, total: 0 });
  expect(progress).toHaveBeenCalledTimes(2);
  request.upload.onprogress?.({ lengthComputable: true, loaded: 75, total: 100 });
  expect(progress).toHaveBeenLastCalledWith(75);
  const completed = vi.fn();
  void result.then(completed);
  await Promise.resolve();
  expect(completed).not.toHaveBeenCalled();
  request.onload?.();
  expect(await result).toMatchObject({ duration_seconds: 90, thumbnail_path: null });
  expect(progress).toHaveBeenLastCalledWith(100);
  expect(phase).toHaveBeenLastCalledWith("Uploading video…");
});

it.each(["http", "network", "abort"])("rejects a failed %s upload", async failure => {
  const { result, request, progress } = await start();
  const rejected = expect(result).rejects.toThrow("Video upload failed");
  if (failure === "http") { request.status = 413; request.onload?.(); }
  else if (failure === "network") request.onerror?.();
  else request.onabort?.();
  await rejected;
  expect(progress).not.toHaveBeenCalledWith(100);
});

it("rejects an expired session before sending a video", async () => {
  mocks.session.mockResolvedValue({ data: { session: null }, error: null });
  await expect(uploadGuideVideo("guide-id", new File(["video"], "guide.mp4", { type: "video/mp4" }), vi.fn(), vi.fn())).rejects.toThrow("Sign in again");
});
