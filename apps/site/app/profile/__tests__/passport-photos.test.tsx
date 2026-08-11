import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PassportPhotos } from "../PassportPhotos";
import { PHOTO_ASPECT } from "@/lib/profileImage";

const uploadProfileImage = vi.fn();
vi.mock("@/lib/profileImage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/profileImage")>()),
  uploadProfileImage: (...args: unknown[]) => uploadProfileImage(...args),
}));

/** The real framer measures a loaded image, which jsdom never does. This stand-in
 *  exposes the two things the band actually depends on: the source it was handed
 *  and the framing it hands back. */
vi.mock("../PhotoFramer", () => ({
  PhotoFramer: ({
    kind,
    src,
    initial,
    onSave,
    onCancel,
  }: {
    kind: string;
    src: string;
    initial: unknown;
    onSave: (f: { x: number; y: number; width: number; height: number }) => void;
    onCancel: () => void;
  }) => (
    <div data-testid="framer" data-kind={kind} data-src={src} data-initial={JSON.stringify(initial)}>
      <button type="button" onClick={() => onSave({ x: 10, y: 20, width: 50, height: 50 })}>
        Save framing
      </button>
      <button type="button" onClick={onCancel}>
        Cancel framing
      </button>
    </div>
  ),
}));

const png = () => new File(["x"], "photo.png", { type: "image/png" });
const AVATAR = "https://cdn.test/u1/avatar-1.png";

function setup(props: Partial<React.ComponentProps<typeof PassportPhotos>> = {}) {
  const onChange = vi.fn().mockResolvedValue(undefined);
  render(
    <PassportPhotos
      userId="u1"
      name="Jamie Cruz"
      mark="JC"
      avatarUrl={null}
      coverUrl={null}
      onChange={onChange}
      {...props}
    />,
  );
  return { onChange };
}

beforeEach(() => {
  uploadProfileImage.mockReset().mockResolvedValue(AVATAR);
  global.URL.createObjectURL = vi.fn(() => "blob:picked");
  global.URL.revokeObjectURL = vi.fn();
});

describe("PassportPhotos", () => {
  it("falls back to the initials monogram when there is no avatar", () => {
    setup();
    expect(screen.getByText("JC")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add profile photo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add cover photo" })).toBeInTheDocument();
    expect(screen.queryByTestId("framer")).not.toBeInTheDocument();
  });

  it("frames a picked photo before uploading anything", async () => {
    const { onChange } = setup();
    await userEvent.upload(screen.getByTestId("avatar-input"), png());

    // Nothing is uploaded until the runner has positioned it.
    expect(uploadProfileImage).not.toHaveBeenCalled();
    expect(screen.getByTestId("framer")).toHaveAttribute("data-src", "blob:picked");

    await userEvent.click(screen.getByRole("button", { name: "Save framing" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith("avatar", `${AVATAR}#c=10,20,50,50`));
    expect(uploadProfileImage).toHaveBeenCalledWith("u1", "avatar", expect.any(File));
  });

  it("uploads a cover as the cover kind", async () => {
    const cover = "https://cdn.test/u1/cover-1.png";
    uploadProfileImage.mockResolvedValue(cover);
    const { onChange } = setup();

    await userEvent.upload(screen.getByTestId("cover-input"), png());
    expect(screen.getByTestId("framer")).toHaveAttribute("data-kind", "cover");
    await userEvent.click(screen.getByRole("button", { name: "Save framing" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith("cover", `${cover}#c=10,20,50,50`));
  });

  it("repositions a stored photo without re-uploading it", async () => {
    const { onChange } = setup({ avatarUrl: `${AVATAR}#c=0,0,40,40` });
    await userEvent.click(screen.getByRole("button", { name: "Reposition" }));

    const framer = screen.getByTestId("framer");
    expect(framer).toHaveAttribute("data-src", AVATAR);
    // Reopening starts from the framing already saved, not from centre.
    expect(JSON.parse(framer.getAttribute("data-initial")!)).toEqual({ x: 0, y: 0, width: 40, height: 40 });

    await userEvent.click(screen.getByRole("button", { name: "Save framing" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith("avatar", `${AVATAR}#c=10,20,50,50`));
    expect(uploadProfileImage).not.toHaveBeenCalled();
  });

  it("offers repositioning for a cover set on mobile, which has no framing yet", async () => {
    const cover = "https://cdn.test/u1/cover-mobile.png";
    setup({ coverUrl: cover });
    await userEvent.click(screen.getByRole("button", { name: "Reposition cover photo" }));

    const framer = screen.getByTestId("framer");
    expect(framer).toHaveAttribute("data-src", cover);
    expect(JSON.parse(framer.getAttribute("data-initial")!)).toEqual({ x: 0, y: 0, width: 100, height: 100 });
  });

  it("keeps the photo untouched when framing is cancelled", async () => {
    const { onChange } = setup();
    await userEvent.upload(screen.getByTestId("avatar-input"), png());
    await userEvent.click(screen.getByRole("button", { name: "Cancel framing" }));

    expect(screen.queryByTestId("framer")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    expect(uploadProfileImage).not.toHaveBeenCalled();
  });

  it("clears the column when a photo is removed", async () => {
    const { onChange } = setup({ avatarUrl: AVATAR });
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith("avatar", null));
    expect(uploadProfileImage).not.toHaveBeenCalled();
  });

  it("surfaces an upload failure instead of leaving the runner guessing", async () => {
    uploadProfileImage.mockRejectedValue(new Error("Please choose a JPG, PNG, or WebP image."));
    const { onChange } = setup();
    await userEvent.upload(screen.getByTestId("avatar-input"), png());
    await userEvent.click(screen.getByRole("button", { name: "Save framing" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Please choose a JPG, PNG, or WebP image.");
    expect(onChange).not.toHaveBeenCalled();
  });

  // The regression this pins: the cropper framed at 16:9 while the band rendered
  // near 4:1, and every cover came out horizontally stretched. Framing carries no
  // aspect of its own, so these two shapes have to be the same number.
  it("renders the cover band at the ratio photos are framed to", () => {
    setup({ coverUrl: "https://cdn.test/u1/cover-1.png#c=0,0,50,50" });
    const band = screen.getByAltText("").parentElement!;
    expect(band).toHaveStyle({ aspectRatio: String(PHOTO_ASPECT.cover) });
  });

  it("renders a stored photo through its saved framing", () => {
    setup({ avatarUrl: `${AVATAR}#c=25,25,25,25` });
    const img = screen.getByAltText("Jamie Cruz's profile photo");
    expect(img).toHaveAttribute("src", AVATAR);
    expect(img).toHaveStyle({ width: "400%", left: "-100%" });
  });
});
