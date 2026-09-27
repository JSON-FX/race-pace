import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChoiceGroup } from "./choice-group";
import { FieldFrame } from "./field-frame";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { NativeSelect } from "./ui/native-select";
import { Checkbox } from "./ui/checkbox";
import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription } from "./ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./ui/tabs";
import { Progress } from "./ui/progress";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "./ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "./ui/sheet";

function ProgrammaticSheet() {
  const [open, setOpen] = useState(false);
  return <><Button onClick={() => setOpen(true)}>Upload photo</Button><Sheet open={open} onOpenChange={setOpen}>
    <SheetContent side="bottom"><SheetTitle>Crop photo</SheetTitle><SheetDescription>Adjust the crop</SheetDescription><Input aria-label="Zoom" /></SheetContent>
  </Sheet></>;
}

function Choices() {
  const [value, setValue] = useState("gcash");
  return <form aria-label="Payment"><ChoiceGroup label="Payment method" name="method" value={value} onValueChange={setValue}
    options={[{ value: "gcash", label: "GCash" }, { value: "paymaya", label: "Maya" }, { value: "card", label: "Card", disabled: true }]} /></form>;
}

describe("Fieldnotes consumer contracts", () => {
  it("keeps links slotted and locks a loading submission", async () => {
    const submit = vi.fn();
    render(<><Button asChild><a href="/races">My races</a></Button><Button loading onClick={submit}>Pay</Button></>);
    expect(screen.getByRole("link", { name: "My races" })).toHaveAttribute("href", "/races");
    await userEvent.click(screen.getByRole("button", { name: "Pay" }));
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Pay" })).toHaveAttribute("aria-busy", "true");
  });
  it("moves radio selection with arrows and preserves the provider form value", async () => {
    render(<Choices />); const user = userEvent.setup();
    screen.getByRole("radio", { name: "GCash" }).focus();
    await user.keyboard("{ArrowRight>}");
    await waitFor(() => expect(screen.getByRole("radio", { name: "Maya" })).toBeChecked());
    await user.keyboard("{/ArrowRight}");
    expect(new FormData(screen.getByRole("form", { name: "Payment" }) as HTMLFormElement).get("method")).toBe("paymaya");
    await user.keyboard("{ArrowRight>}");
    await waitFor(() => expect(screen.getByRole("radio", { name: "GCash" })).toBeChecked());
    await user.keyboard("{/ArrowRight}");
  });
  it("connects labels, hints and field errors without changing native values", () => {
    render(<form aria-label="Details"><FieldFrame label="ZIP code" required hint="Four digits" error="Required" htmlFor="zip"><Input name="zip" defaultValue="0123" required /></FieldFrame>
      <NativeSelect name="region" defaultValue="r"><option value="r">Region</option></NativeSelect><Checkbox name="waiver" defaultChecked value="accepted" aria-label="Waiver" /></form>);
    const input = screen.getByRole("textbox", { name: "ZIP code" });
    expect(input).toHaveAccessibleDescription("Four digits Required");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toBeRequired();
    const data = new FormData(screen.getByRole("form", { name: "Details" }) as HTMLFormElement);
    expect(Object.fromEntries(data)).toEqual({ zip: "0123", region: "r", waiver: "accepted" });
  });
  it("traps modal focus, dismisses with Escape and restores the trigger", async () => {
    render(<><Button>Outside</Button><Dialog><DialogTrigger asChild><Button>Edit</Button></DialogTrigger>
      <DialogContent><DialogTitle>Edit photo</DialogTitle><DialogDescription>Adjust the photo</DialogDescription><Input aria-label="Photo title" /><Button>Save</Button></DialogContent></Dialog></>);
    const user = userEvent.setup(); const trigger = screen.getByRole("button", { name: "Edit" });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog");
    for (let i = 0; i < 6; i++) { await user.tab(); expect(dialog.contains(document.activeElement)).toBe(true); }
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
  it("links tabs to panels and supports arrow navigation", async () => {
    render(<Tabs defaultValue="upcoming"><TabsList aria-label="Races"><TabsTrigger value="upcoming">Upcoming</TabsTrigger><TabsTrigger value="past">Past</TabsTrigger></TabsList><TabsContent value="upcoming">Next race</TabsContent><TabsContent value="past">Past race</TabsContent></Tabs>);
    screen.getByRole("tab", { name: "Upcoming" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Past" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Past race");
    expect(screen.getByRole("tab", { name: "Past" })).toHaveAttribute("aria-controls", screen.getByRole("tabpanel").id);
  });
  it("restores the opener when an asynchronous workflow has no modal trigger", async () => {
    render(<ProgrammaticSheet />);
    const user = userEvent.setup(); const opener = screen.getByRole("button", { name: "Upload photo" });
    await user.click(opener);
    expect(screen.getByRole("dialog")).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(opener).toHaveFocus());
  });
  it("distinguishes measured and indeterminate progress", () => {
    const { rerender } = render(<Progress value={40} aria-label="Upload" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40");
    rerender(<Progress value={null} aria-label="Navigation" />);
    expect(screen.getByRole("progressbar")).not.toHaveAttribute("aria-valuenow");
  });
});

function MenuDialog() {
  const [open, setOpen] = useState(false);
  return <><DropdownMenu><DropdownMenuTrigger asChild><Button>Row actions</Button></DropdownMenuTrigger><DropdownMenuContent><DropdownMenuItem onSelect={() => setOpen(true)}>Edit row</DropdownMenuItem></DropdownMenuContent></DropdownMenu><Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogTitle>Edit row</DialogTitle><DialogDescription>Update the row</DialogDescription><Input aria-label="Name" /></DialogContent></Dialog></>;
}
it("restores the row action trigger after a menu opens a modal", async () => {
  render(<MenuDialog />);
  const user = userEvent.setup();
  const trigger = screen.getByRole("button", { name: "Row actions" });
  await user.click(trigger);
  await user.click(screen.getByRole("menuitem", { name: "Edit row" }));
  await user.keyboard("{Escape}");
  await waitFor(() => expect(trigger).toHaveFocus());
});
