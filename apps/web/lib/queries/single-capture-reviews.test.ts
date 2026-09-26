import { beforeEach, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));

import { listSingleCaptureReviews } from "./single-capture-reviews";

beforeEach(() => rpc.mockReset());

it("reads the platform-only capture projection", async () => {
  const rows = [{ provider_payment_id: "pay_review" }];
  rpc.mockResolvedValue({ data: rows, error: null });
  await expect(listSingleCaptureReviews()).resolves.toEqual(rows);
  expect(rpc).toHaveBeenCalledExactlyOnceWith("platform_single_capture_reviews");
});

it("does not hide an authorization or database failure", async () => {
  const error = new Error("permission denied");
  rpc.mockResolvedValue({ data: null, error });
  await expect(listSingleCaptureReviews()).rejects.toBe(error);
});
