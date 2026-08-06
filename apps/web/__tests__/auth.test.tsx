import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Login } from "../routes/Login";

const mockSignIn = vi.fn();
vi.mock("../lib/auth", () => ({ useAuth: () => ({ signIn: mockSignIn, session: null }) }));

it("shows the error returned by signIn", async () => {
  mockSignIn.mockResolvedValue({ error: "Invalid login credentials" });
  render(<MemoryRouter><Login /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "x@test.dev" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "wrong" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  await waitFor(() => expect(screen.getByText("Invalid login credentials")).toBeInTheDocument());
});
