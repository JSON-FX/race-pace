import { beforeEach, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));

import { listUnboundCheckoutReviews } from "./unbound-checkouts";

beforeEach(() => rpc.mockReset());

it("reads only the platform review RPC and returns its rows", async () => {
  const rows = [{ registration_id: "registration-1" }];
  rpc.mockResolvedValue({ data: rows, error: null });
  await expect(listUnboundCheckoutReviews()).resolves.toEqual(rows);
  expect(rpc).toHaveBeenCalledExactlyOnceWith("platform_unbound_checkout_reviews");
});

it("does not turn an RPC authorization error into an empty queue", async () => {
  const error = new Error("permission denied");
  rpc.mockResolvedValue({ data: null, error });
  await expect(listUnboundCheckoutReviews()).rejects.toBe(error);
});
