import { registerForPush } from "../lib/push";

const mockUpsert = jest.fn(async () => ({ error: null }));
jest.mock("../lib/supabase", () => ({ supabase: { from: jest.fn(() => ({ upsert: mockUpsert })) } }));

describe("registerForPush", () => {
  it("gets an Expo token and upserts it against device_tokens", async () => {
    const token = await registerForPush("u1");
    expect(token).toBe("ExponentPushToken[test]");
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "u1", token: "ExponentPushToken[test]" }),
      { onConflict: "token" },
    );
  });

  it("returns null on a simulator (no device)", async () => {
    jest.resetModules();
    jest.doMock("expo-device", () => ({ isDevice: false }));
    const { registerForPush: reg } = require("../lib/push");
    expect(await reg("u1")).toBeNull();
  });
});
