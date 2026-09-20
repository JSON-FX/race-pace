import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const getMyRoles = vi.fn();
const getPlatformUsers = vi.fn();
const notFound = vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); });

vi.mock("@/lib/queries/roles", () => ({ getMyRoles: () => getMyRoles() }));
vi.mock("@/lib/queries/platform-users", () => ({ getPlatformUsers: () => getPlatformUsers() }));
vi.mock("next/navigation", () => ({ notFound: () => notFound() }));
vi.mock("./users-directory", () => ({ UsersDirectory: ({ initialUsers }: { initialUsers: unknown[] }) => <div>{initialUsers.length} directory users</div> }));

import UsersPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  getPlatformUsers.mockResolvedValue([]);
});

it("404s a non-platform administrator before loading user data", async () => {
  getMyRoles.mockResolvedValue({ capabilities: ["manage_org"], isSuperAdmin: false });
  await expect(UsersPage()).rejects.toThrow("NEXT_NOT_FOUND");
  expect(getPlatformUsers).not.toHaveBeenCalled();
});

it("loads the platform directory for a super administrator", async () => {
  getMyRoles.mockResolvedValue({ capabilities: ["manage_platform"], isSuperAdmin: true });
  getPlatformUsers.mockResolvedValue([{ id: "u1" }]);
  render(await UsersPage());
  expect(screen.getByRole("heading", { name: "Registered users" })).toBeInTheDocument();
  expect(screen.getByText("1 directory users")).toBeInTheDocument();
});
