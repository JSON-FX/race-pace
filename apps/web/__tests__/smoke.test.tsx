import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "../lib/auth";
import { App } from "../App";

it("unauthenticated visitor lands on the sign-in form", async () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthProvider><App /></AuthProvider>
    </QueryClientProvider>
  );
  expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
});
