import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { EventImagesEditor } from "../components/EventImagesEditor";

const uploadMock = vi.fn();
vi.mock("../lib/imageUpload", () => ({ uploadEventImage: (...a: unknown[]) => uploadMock(...a) }));

function png(name: string) { return new File([new Uint8Array([1])], name, { type: "image/png" }); }

beforeEach(() => uploadMock.mockReset());

it("uploads a picked file and reports it as the featured image", async () => {
  uploadMock.mockResolvedValueOnce("https://cdn/a1/one.png");
  const onChange = vi.fn();
  render(<EventImagesEditor orgId="a1" heroUrl={null} gallery={[]} onChange={onChange} />);
  fireEvent.change(screen.getByLabelText("Add images"), { target: { files: [png("one.png")] } });
  await waitFor(() =>
    expect(onChange).toHaveBeenCalledWith({ hero_image_url: "https://cdn/a1/one.png", gallery: [] }));
});

it("renders a grid and, on star, splits featured vs the rest", () => {
  const onChange = vi.fn();
  render(<EventImagesEditor orgId="a1" heroUrl="https://cdn/hero.png"
    gallery={["https://cdn/g1.png", "https://cdn/g2.png"]} onChange={onChange} />);
  expect(screen.getAllByRole("img")).toHaveLength(3);
  // Non-featured tiles carry the "Set as featured" label; the 2nd is g2.
  fireEvent.click(screen.getAllByLabelText("Set as featured")[1]!);
  expect(onChange).toHaveBeenCalledWith({
    hero_image_url: "https://cdn/g2.png",
    gallery: ["https://cdn/hero.png", "https://cdn/g1.png"],
  });
});

it("removing the featured promotes the next image", () => {
  const onChange = vi.fn();
  render(<EventImagesEditor orgId="a1" heroUrl="https://cdn/hero.png"
    gallery={["https://cdn/g1.png"]} onChange={onChange} />);
  fireEvent.click(screen.getAllByLabelText("Remove image")[0]!); // remove the hero (first tile)
  expect(onChange).toHaveBeenCalledWith({ hero_image_url: "https://cdn/g1.png", gallery: [] });
});

it("hides the picker at the 8-image cap", () => {
  const g = Array.from({ length: 7 }, (_, i) => `https://cdn/g${i}.png`);
  render(<EventImagesEditor orgId="a1" heroUrl="https://cdn/hero.png" gallery={g} onChange={vi.fn()} />);
  expect(screen.queryByLabelText("Add images")).toBeNull(); // 1 + 7 = 8 → full
});

it("adds multiple files in one batch, keeping the first as featured", async () => {
  uploadMock.mockResolvedValueOnce("https://cdn/a1/one.png").mockResolvedValueOnce("https://cdn/a1/two.png");
  const onChange = vi.fn();
  render(<EventImagesEditor orgId="a1" heroUrl={null} gallery={[]} onChange={onChange} />);
  fireEvent.change(screen.getByLabelText("Add images"), { target: { files: [png("one.png"), png("two.png")] } });
  await waitFor(() =>
    expect(onChange).toHaveBeenLastCalledWith({ hero_image_url: "https://cdn/a1/one.png", gallery: ["https://cdn/a1/two.png"] }));
});

it("locks starring/removing and re-picking while an upload is in flight", async () => {
  let resolve!: (u: string) => void;
  uploadMock.mockReturnValueOnce(new Promise<string>((r) => { resolve = r; }));
  render(<EventImagesEditor orgId="a1" heroUrl="https://cdn/hero.png" gallery={[]} onChange={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Add images"), { target: { files: [png("new.png")] } });
  expect(await screen.findByLabelText("Uploading")).toBeInTheDocument();
  expect(screen.queryByLabelText("Add images")).toBeNull();      // picker hidden while pending
  expect(screen.getByLabelText("Featured image")).toBeDisabled();
  expect(screen.getByLabelText("Remove image")).toBeDisabled();
  resolve("https://cdn/a1/new.png");
  await waitFor(() => expect(screen.queryByLabelText("Uploading")).toBeNull());
});
