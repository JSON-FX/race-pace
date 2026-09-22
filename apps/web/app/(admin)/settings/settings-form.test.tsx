import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { SettingsForm } from "./settings-form";
import type { OrgBranding } from "@/lib/queries/org";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock("react-easy-crop", async () => {
  const React = await import("react");
  return {
    default: ({ onCropComplete }: { onCropComplete: (a: unknown, p: unknown) => void }) => {
      React.useEffect(() => { onCropComplete({}, { x: 0, y: 0, width: 100, height: 100 }); }, []);
      return React.createElement("div", { "data-testid": "cropper" });
    },
  };
});
vi.mock("@/lib/cropImage", () => ({ getCroppedBlob: () => Promise.resolve(new Blob([""], { type: "image/png" })) }));

const uploadOrgImage = vi.fn(async () => Promise.resolve("https://cdn/org-images/a1/avatar-x.png"));
vi.mock("@/lib/org-upload", () => ({
  uploadOrgImage: (...args: unknown[]) => uploadOrgImage(...(args as Parameters<typeof uploadOrgImage>)),
}));

const updateOrgBrandingAction = vi.fn(async () => Promise.resolve({ ok: true }));
const updateOrgNameAction = vi.fn(async () => Promise.resolve({ success: "Organization name updated." }));
const updateOrgCheckInDefaultAction = vi.fn(async (_prev: unknown, _formData: FormData) => Promise.resolve({ success: "Default check-in setting updated." }));
vi.mock("@/lib/actions/settings", () => ({
  updateOrgBrandingAction: (...args: unknown[]) =>
    updateOrgBrandingAction(...(args as Parameters<typeof updateOrgBrandingAction>)),
  updateOrgNameAction: (...args: unknown[]) => updateOrgNameAction(...(args as Parameters<typeof updateOrgNameAction>)),
  updateOrgCheckInDefaultAction: (...args: unknown[]) => updateOrgCheckInDefaultAction(...(args as Parameters<typeof updateOrgCheckInDefaultAction>)),
}));

const org: OrgBranding = { id: "a1", name: "TrailNorth", logo_url: null, banner_url: null, check_in_required_default: true };

beforeEach(() => {
  (URL as unknown as { createObjectURL: (b: unknown) => string }).createObjectURL = () => "blob:mock";
  (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = () => {};
  refresh.mockClear();
  uploadOrgImage.mockClear();
  updateOrgBrandingAction.mockClear();
  updateOrgNameAction.mockClear();
  updateOrgCheckInDefaultAction.mockClear();
});

describe("SettingsForm", () => {
  it("renders avatar and cover uploaders and the org name field", () => {
    render(<SettingsForm org={org} canEdit />);
    expect(screen.getByText("Organization avatar")).toBeInTheDocument();
    expect(screen.getByText("Cover photo")).toBeInTheDocument();
    expect(screen.getByLabelText("Organization name")).toHaveValue("TrailNorth");
  });

  it("crops and saves an avatar upload, then refreshes to pick up the new URL", async () => {
    render(<SettingsForm org={org} canEdit />);
    const file = new File([new Uint8Array([1])], "a.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Choose Organization avatar"), { target: { files: [file] } });
    expect(await screen.findByRole("dialog", { name: "Crop Organization avatar" })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("dialog", { name: "Crop Organization avatar" })).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(uploadOrgImage).toHaveBeenCalledWith("a1", expect.anything(), "avatar"));
    await waitFor(() =>
      expect(updateOrgBrandingAction).toHaveBeenCalledWith("a1", { logo_url: "https://cdn/org-images/a1/avatar-x.png" }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("submits the org name to updateOrgNameAction", async () => {
    render(<SettingsForm org={org} canEdit />);
    fireEvent.change(screen.getByLabelText("Organization name"), { target: { value: "Renamed Org" } });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(updateOrgNameAction).toHaveBeenCalled());
  });

  it("hides the branding upload controls and disables the name field when canEdit is false", () => {
    render(<SettingsForm org={org} canEdit={false} />);
    expect(screen.queryByText("Choose Avatar")).not.toBeInTheDocument();
    expect(screen.getByText(/only organization admins can update branding/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Organization name")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save profile" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save default" })).toBeDisabled();
  });

  it("submits a false default when the organizer unchecks event check-in", async () => {
    render(<SettingsForm org={org} canEdit />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Require event check-in by default" }));
    fireEvent.click(screen.getByRole("button", { name: "Save default" }));
    await waitFor(() => expect(updateOrgCheckInDefaultAction).toHaveBeenCalled());
    const submitted = updateOrgCheckInDefaultAction.mock.calls.at(-1)?.[1] as FormData;
    expect(submitted.getAll("checkInRequired")).toEqual(["false"]);
  });
});
