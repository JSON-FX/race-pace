import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "../lib/auth";
import { OrgProvider } from "../lib/orgContext";
import { App } from "../App";

// Provider order mirrors main.tsx: OrgProvider reads the session and owns the
// user_roles query, so it must sit inside both of the others.
it("unauthenticated visitor lands on the sign-in form", async () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthProvider><OrgProvider><App /></OrgProvider></AuthProvider>
    </QueryClientProvider>
  );
  expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
});
