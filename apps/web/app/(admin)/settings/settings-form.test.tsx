import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { SettingsForm } from "./settings-form";
import type { OrgBranding } from "@/lib/queries/org";
import type { PsgcAddress } from "@race-pace/shared";

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
vi.mock("@/components/PsgcAddressField", () => ({
  PsgcAddressField: ({ onChange, cityForm, cityName }: { onChange: (address: PsgcAddress) => void; cityForm?: string; cityName?: string }) => (
    <select aria-label="City" form={cityForm} name={cityName} onChange={(event) => onChange({ city_psgc_code: event.target.value, city_name: "Digos", province_name: "Davao del Sur", region_name: "Davao Region" })}>
      <option value="">— Select —</option>
      <option value="112603000">Digos</option>
    </select>
  ),
}));

const uploadOrgImage = vi.fn(async () => Promise.resolve("https://cdn/org-images/a1/avatar-x.png"));
vi.mock("@/lib/org-upload", () => ({
  uploadOrgImage: (...args: unknown[]) => uploadOrgImage(...(args as Parameters<typeof uploadOrgImage>)),
}));

const updateOrgBrandingAction = vi.fn(async () => Promise.resolve({ ok: true }));
const updateOrgProfileAction = vi.fn(async (_prev: unknown, _formData: FormData) => Promise.resolve({ success: "Organization profile updated." }));
const updateOrgCheckInDefaultAction = vi.fn(async (_prev: unknown, _formData: FormData) => Promise.resolve({ success: "Default check-in setting updated." }));
vi.mock("@/lib/actions/settings", () => ({
  updateOrgBrandingAction: (...args: unknown[]) =>
    updateOrgBrandingAction(...(args as Parameters<typeof updateOrgBrandingAction>)),
  updateOrgProfileAction: (...args: unknown[]) => updateOrgProfileAction(...(args as Parameters<typeof updateOrgProfileAction>)),
  updateOrgCheckInDefaultAction: (...args: unknown[]) => updateOrgCheckInDefaultAction(...(args as Parameters<typeof updateOrgCheckInDefaultAction>)),
}));

const org: OrgBranding = {
  id: "a1", name: "TrailNorth", description: "Runs rooted in the community.",
  home_city_psgc_code: null, home_city_name: null, home_province_name: null, home_region_name: null,
  logo_url: null, banner_url: null, featured_image_url: null, check_in_required_default: true,
};

beforeEach(() => {
  (URL as unknown as { createObjectURL: (b: unknown) => string }).createObjectURL = () => "blob:mock";
  (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = () => {};
  refresh.mockClear();
  uploadOrgImage.mockClear();
  updateOrgBrandingAction.mockClear();
  updateOrgProfileAction.mockClear();
  updateOrgCheckInDefaultAction.mockClear();
});

describe("SettingsForm", () => {
  it("renders avatar, cover, and optional featured image uploaders in the existing Settings card", () => {
    render(<SettingsForm org={org} canEdit />);
    expect(screen.getByText("Organization avatar")).toBeInTheDocument();
    expect(screen.getByText("Cover photo")).toBeInTheDocument();
    expect(screen.getByText("Organizer featured image")).toBeInTheDocument();
    expect(screen.getByText("Recommended 7:5 landscape photo")).toBeInTheDocument();
    expect(screen.getByLabelText("Organization name")).toHaveValue("TrailNorth");
  });

  it("crops and saves a separate featured image", async () => {
    render(<SettingsForm org={org} canEdit />);
    const file = new File([new Uint8Array([1])], "featured.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("Choose Organizer featured image"), { target: { files: [file] } });
    const dialog = await screen.findByRole("dialog", { name: "Crop Organizer featured image" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(uploadOrgImage).toHaveBeenCalledWith("a1", expect.anything(), "featured"));
    await waitFor(() => expect(updateOrgBrandingAction).toHaveBeenCalledWith("a1", { featured_image_url: "https://cdn/org-images/a1/avatar-x.png" }));
  });

  it("clears an existing featured image", async () => {
    render(<SettingsForm org={{ ...org, featured_image_url: "https://cdn.test/featured.png" }} canEdit />);
    fireEvent.click(screen.getByRole("button", { name: "Remove image" }));
    await waitFor(() => expect(updateOrgBrandingAction).toHaveBeenCalledWith("a1", { featured_image_url: null }));
    expect(uploadOrgImage).not.toHaveBeenCalled();
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

  it("submits the name, description, and home base in the profile form", async () => {
    render(<SettingsForm org={org} canEdit />);
    expect(screen.getByRole("combobox", { name: "City" }).closest("form")).toBeNull();
    expect(screen.getByRole("combobox", { name: "City" })).toHaveAttribute("form", "org-profile-form");
    fireEvent.change(screen.getByLabelText("Organization name"), { target: { value: "Renamed Org" } });
    fireEvent.change(screen.getByLabelText("Organizer Description"), { target: { value: "Our local running club." } });
    fireEvent.change(screen.getByRole("combobox", { name: "City" }), { target: { value: "112603000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(updateOrgProfileAction).toHaveBeenCalled());
    const submitted = updateOrgProfileAction.mock.calls.at(-1)?.[1] as FormData;
    expect(submitted.get("name")).toBe("Renamed Org");
    expect(submitted.get("description")).toBe("Our local running club.");
    expect(submitted.get("homeCityPsgcCode")).toBe("112603000");
  });

  it("hides the branding upload controls and disables the name field when canEdit is false", () => {
    render(<SettingsForm org={org} canEdit={false} />);
    expect(screen.queryByText("Choose Avatar")).not.toBeInTheDocument();
    expect(screen.getByText(/only organization admins can update branding/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Organization name")).toBeDisabled();
    expect(screen.getByLabelText("Organizer Description")).toBeDisabled();
    expect(screen.getByText("Not set")).toBeInTheDocument();
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
