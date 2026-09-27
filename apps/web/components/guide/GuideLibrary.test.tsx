import { beforeEach, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GuideVideo } from "@/lib/guides";

const mocks = vi.hoisted(() => ({ playback: vi.fn(), save: vi.fn(), upload: vi.fn(), router: { refresh: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("@/lib/actions/guides", () => ({ guidePlaybackAction: mocks.playback, saveGuideAction: mocks.save }));
vi.mock("@/lib/guide-upload", () => ({ uploadGuideVideo: mocks.upload }));
import { GuideLibrary } from "./GuideLibrary";

const id = "11111111-1111-4111-8111-111111111111";
const uploadId = "22222222-2222-4222-8222-222222222222";
function guide(overrides: Partial<GuideVideo> = {}): GuideVideo {
  return {
    id, title: "Create your race", description: "Review categories and capacity.", topic: "Events", duration_seconds: 60,
    storage_path: `${id}/${uploadId}.mp4`, thumbnail_path: null, is_published: true,
    created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z", ...overrides,
  };
}
const published = guide();
const relatedId = "33333333-3333-4333-8333-333333333333";
const related = guide({ id: relatedId, title: "Set available slots", description: "Allocate places across distances.", duration_seconds: 35, storage_path: `${relatedId}/${uploadId}.webm` });
const draftId = "44444444-4444-4444-8444-444444444444";
const draft = guide({ id: draftId, title: "Internal draft", description: "Unpublished race preparation.", is_published: false, storage_path: `${draftId}/${uploadId}.mp4` });
const records = [draft, published, related];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.playback.mockResolvedValue({ url: "https://storage.example/signed-video" });
  mocks.save.mockResolvedValue({ ok: true });
  mocks.upload.mockImplementation(async (guideId: string) => ({ storage_path: `${guideId}/${uploadId}.mp4`, thumbnail_path: null, duration_seconds: 95 }));
});

it("keeps drafts out of org-admin cards, featured guide, and related videos", async () => {
  const user = userEvent.setup();
  render(<GuideLibrary guides={records} isSuperAdmin={false} />);
  expect(screen.queryByText("Internal draft")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Manage guides" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Upload video" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Watch Create your race" }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByRole("heading", { name: "More in Events" })).toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "Set available slots" })).toBeInTheDocument();
  expect(within(dialog).queryByText("Internal draft")).not.toBeInTheDocument();
  await waitFor(() => expect(mocks.playback).toHaveBeenCalledWith(published.id));
  expect(mocks.playback).not.toHaveBeenCalledWith(draft.id);
});

it("removes an open guide and its featured entry when refreshed props unpublish it", async () => {
  const user = userEvent.setup();
  const { rerender } = render(<GuideLibrary guides={[published, related]} isSuperAdmin={false} />);
  await user.click(screen.getByRole("button", { name: "Watch Create your race" }));
  await screen.findByRole("dialog");
  rerender(<GuideLibrary guides={[{ ...published, is_published: false }, related]} isSuperAdmin={false} />);
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.queryByText("Create your race")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Watch Set available slots" })).toBeInTheDocument();
});

it("shows the unpublished-only library as empty to org admins", () => {
  render(<GuideLibrary guides={[draft]} isSuperAdmin={false} />);
  expect(screen.getByRole("heading", { name: "Guides are on their way" })).toBeInTheDocument();
  expect(screen.queryByText("Internal draft")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Upload first guide" })).not.toBeInTheDocument();
});

it("searches descriptions, combines topic filters, and clears both after no results", async () => {
  const user = userEvent.setup();
  render(<GuideLibrary guides={records} isSuperAdmin={false} />);
  await user.type(screen.getByRole("searchbox", { name: "Search guides" }), "capacity");
  expect(screen.getByRole("heading", { name: "Create your race" })).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Set available slots" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Payments" }));
  expect(screen.getByRole("heading", { name: "No matching guides" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Clear filters" }));
  expect(screen.getByRole("searchbox", { name: "Search guides" })).toHaveValue("");
  expect(screen.getByRole("button", { name: "All guides" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("heading", { name: "Browse video guides" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Watch Create your race" })).toBeInTheDocument();
});

it("retries unavailable playback and exposes native controls only after signing succeeds", async () => {
  const user = userEvent.setup();
  mocks.playback.mockResolvedValueOnce({ error: "This guide is no longer available. Refresh the library." }).mockResolvedValueOnce({ url: "https://storage.example/retried-video" });
  render(<GuideLibrary guides={[published]} isSuperAdmin={false} />);
  await user.click(screen.getByRole("button", { name: "Watch Create your race" }));
  const dialog = await screen.findByRole("dialog");
  expect(await within(dialog).findByText("This guide is no longer available. Refresh the library.")).toBeInTheDocument();
  expect(dialog.querySelector("video")).toBeNull();
  await user.click(within(dialog).getByRole("button", { name: "Retry video" }));
  await waitFor(() => expect(dialog.querySelector("video")).toHaveAttribute("src", "https://storage.example/retried-video"));
  expect(dialog.querySelector("video")).toHaveAttribute("controls");
  expect(mocks.playback).toHaveBeenCalledTimes(2);
});

it("allows super admins to manage drafts and edit metadata without uploading again", async () => {
  const user = userEvent.setup();
  render(<GuideLibrary guides={records} isSuperAdmin />);
  expect(screen.queryByText("Internal draft")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Manage guides" }));
  expect(screen.getByRole("heading", { name: "Internal draft" })).toBeInTheDocument();
  const row = screen.getByRole("heading", { name: "Create your race" }).closest(".gd-manage-row");
  expect(row).not.toBeNull();
  await user.click(within(row as HTMLElement).getByRole("button", { name: "Edit guide" }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByRole("textbox", { name: "Title" })).toHaveValue(published.title);
  expect(within(dialog).getByLabelText("Description")).toHaveValue(published.description);
  await user.clear(within(dialog).getByRole("textbox", { name: "Title" }));
  await user.type(within(dialog).getByRole("textbox", { name: "Title" }), "Prepare your race");
  await user.click(within(dialog).getByRole("button", { name: "Save changes" }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledWith({ id: published.id, title: "Prepare your race", description: published.description,
    topic: published.topic, storage_path: published.storage_path, thumbnail_path: published.thumbnail_path, duration_seconds: published.duration_seconds, is_published: true }));
  expect(mocks.upload).not.toHaveBeenCalled();
  await waitFor(() => expect(mocks.router.refresh).toHaveBeenCalledTimes(1));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("retains uploaded media after a failed metadata save so retry does not reupload", async () => {
  const user = userEvent.setup();
  mocks.save.mockResolvedValueOnce({ ok: false, error: "Your upload is ready; try saving again." }).mockResolvedValueOnce({ ok: true });
  render(<GuideLibrary guides={[]} isSuperAdmin />);
  await user.click(screen.getByRole("button", { name: "Upload video" }));
  const dialog = await screen.findByRole("dialog");
  await user.type(within(dialog).getByRole("textbox", { name: "Title" }), "New guide");
  await user.type(within(dialog).getByLabelText("Description"), "Prepare a race.");
  await user.upload(within(dialog).getByLabelText("Video file"), new File(["video"], "guide.mp4", { type: "video/mp4" }));
  await user.click(within(dialog).getByRole("button", { name: "Publish guide" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("Your upload is ready; try saving again.");
  expect(mocks.router.refresh).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole("button", { name: "Publish guide" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(mocks.upload).toHaveBeenCalledTimes(1);
  expect(mocks.save).toHaveBeenCalledTimes(2);
  expect(mocks.save.mock.calls[1]?.[0]).toEqual(mocks.save.mock.calls[0]?.[0]);
  expect(mocks.router.refresh).toHaveBeenCalledTimes(1);
});

it("blocks an empty video file before upload or metadata save", async () => {
  const user = userEvent.setup();
  render(<GuideLibrary guides={[]} isSuperAdmin />);
  await user.click(screen.getByRole("button", { name: "Upload video" }));
  const dialog = await screen.findByRole("dialog");
  await user.type(within(dialog).getByRole("textbox", { name: "Title" }), "New guide");
  await user.type(within(dialog).getByLabelText("Description"), "Prepare a race.");
  await user.upload(within(dialog).getByLabelText("Video file"), new File([], "empty.mp4", { type: "video/mp4" }));
  expect(within(dialog).getByRole("alert")).toHaveTextContent("This file is empty. Choose another video.");
  await user.click(within(dialog).getByRole("button", { name: "Publish guide" }));
  expect(within(dialog).getByRole("alert")).toHaveTextContent("This file is empty. Choose another video.");
  expect(mocks.upload).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
});

it("does not save existing metadata after choosing an invalid replacement video", async () => {
  const user = userEvent.setup();
  render(<GuideLibrary guides={[published]} isSuperAdmin />);
  await user.click(screen.getByRole("button", { name: "Manage guides" }));
  await user.click(screen.getByRole("button", { name: "Edit guide" }));
  const dialog = await screen.findByRole("dialog");
  await user.upload(within(dialog).getByLabelText("Video file"), new File([], "empty.mp4", { type: "video/mp4" }));
  await user.click(within(dialog).getByRole("button", { name: "Save changes" }));
  expect(within(dialog).getByRole("alert")).toHaveTextContent("This file is empty. Choose another video.");
  expect(mocks.upload).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
  expect(mocks.router.refresh).not.toHaveBeenCalled();
});


it("shows accessible byte progress while upload and save remain pending", async () => {
  const user = userEvent.setup();
  let advance: (percent: number) => void = () => {};
  let finish: (media: { storage_path: string; thumbnail_path: null; duration_seconds: number }) => void = () => {};
  mocks.upload.mockImplementation((_id, _file, phase, progress) => {
    phase("Uploading video…"); progress(25); advance = progress;
    return new Promise(resolve => { finish = resolve; });
  });
  mocks.save.mockResolvedValue({ ok: false, error: "Try saving again." });
  render(<GuideLibrary guides={[]} isSuperAdmin />);
  await user.click(screen.getByRole("button", { name: "Upload video" }));
  const dialog = await screen.findByRole("dialog");
  await user.type(within(dialog).getByRole("textbox", { name: "Title" }), "New guide");
  await user.type(within(dialog).getByLabelText("Description"), "Prepare a race.");
  expect(within(dialog).getByText(/Up to 100 MB/)).toBeInTheDocument();
  await user.upload(within(dialog).getByLabelText("Video file"), new File(["video"], "guide.mp4", { type: "video/mp4" }));
  await user.click(within(dialog).getByRole("button", { name: "Publish guide" }));
  const bar = await within(dialog).findByRole("progressbar", { name: "Video upload progress" });
  expect(bar).toHaveAttribute("aria-valuenow", "25");
  expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
  expect(mocks.save).not.toHaveBeenCalled();
  act(() => advance(75));
  expect(bar).toHaveAttribute("aria-valuenow", "75");
  act(() => advance(100));
  expect(within(dialog).getByRole("status")).toHaveTextContent("Finishing upload…");
  await act(async () => finish({ storage_path: `${id}/${uploadId}.mp4`, thumbnail_path: null, duration_seconds: 95 }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("Try saving again.");
  expect(within(dialog).queryByRole("progressbar")).not.toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "Publish guide" })).toBeEnabled();
});
