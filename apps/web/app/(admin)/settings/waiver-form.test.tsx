import { expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { WaiverForm } from "./waiver-form";
vi.mock("@/lib/actions/waivers", () => ({ publishWaiverAction: vi.fn(), selectEventWaiverAction: vi.fn() }));
it("requires review again whenever the document changes", () => {
 render(<WaiverForm orgId="org" versions={[]} canEdit />);
 const publish = screen.getByRole("button", { name: "Publish waiver version" });
 expect(publish).toBeDisabled();
 fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Waiver" } });
 fireEvent.change(screen.getByLabelText("Waiver text"), { target: { value: "First version" } });
 fireEvent.click(screen.getByRole("checkbox")); expect(publish).toBeEnabled();
 fireEvent.change(screen.getByLabelText("Waiver text"), { target: { value: "Changed version" } });
 expect(screen.getByRole("checkbox")).not.toBeChecked(); expect(publish).toBeDisabled();
});
it("shows published history without publication controls for non-admins", () => {
 render(<WaiverForm orgId="org" canEdit={false} versions={[{ id: "v", title: "Published waiver", body: "Exact original text", published_at: "2026-09-16T00:00:00Z" }]} />);
 expect(screen.queryByRole("button", { name: "Publish waiver version" })).not.toBeInTheDocument();
 expect(screen.getByText("Exact original text")).toBeInTheDocument();
});
