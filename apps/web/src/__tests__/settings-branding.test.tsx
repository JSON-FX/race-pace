import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

beforeEach(() => {
  (URL as unknown as { createObjectURL: (b: unknown) => string }).createObjectURL = () => "blob:mock";
  (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = () => {};
});

vi.mock("../lib/roles", () => ({ useMyRoles: vi.fn(() => ({ data: { orgId: "a1" } })) }));
vi.mock("react-easy-crop", async () => {
  const React = await import("react");
  return { default: ({ onCropComplete }: { onCropComplete: (a: unknown, p: unknown) => void }) => {
    React.useEffect(() => { onCropComplete({}, { x: 0, y: 0, width: 100, height: 100 }); }, []);
    return React.createElement("div", { "data-testid": "cropper" });
  } };
});
vi.mock("../lib/cropImage", () => ({ getCroppedBlob: () => Promise.resolve(new Blob([""], { type: "image/png" })) }));
const uploadOrgImage = vi.fn(async () => Promise.resolve("https://cdn/org-images/a1/avatar-x.png"));
const updateOrgBranding = vi.fn(async () => Promise.resolve({ ok: true }));
vi.mock("../lib/org", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/org")>();
  return {
    ...actual,
    useMyOrg: () => ({ data: { id: "a1", name: "Muspo", logo_url: null, banner_url: null } }),
    uploadOrgImage: async (...args: unknown[]) => uploadOrgImage(...(args as Parameters<typeof uploadOrgImage>)),
    updateOrgBranding: async (...args: unknown[]) => updateOrgBranding(...(args as Parameters<typeof updateOrgBranding>)),
  };
});

import { useMyRoles } from "../lib/roles";
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

it("shows a message when the account has no organization", () => {
  (useMyRoles as unknown as { mockReturnValueOnce: (v: unknown) => void }).mockReturnValueOnce({ data: { orgId: null } });
  wrap(<Settings />);
  expect(screen.getByText(/isn't linked to an organization/i)).toBeInTheDocument();
});
