import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ functions: { invoke: vi.fn() } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { NewOrgDialog } from "./new-org-dialog";

describe("NewOrgDialog", () => {
  // The database default on organizations.commission_rate is 0.03. The form
  // used to open at 10%, so every org provisioned through the console
  // contradicted the schema's own default.
  it("opens at 3%", async () => {
    const user = userEvent.setup();
    render(<NewOrgDialog />);
    await user.click(screen.getByRole("button", { name: /new organization/i }));
    expect(screen.getByLabelText(/rate/i)).toHaveValue(3);
  });
});
