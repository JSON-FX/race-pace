import { registerForPush } from "../lib/push";

const mockUpsert = jest.fn(async () => ({ error: null }));
jest.mock("../lib/supabase", () => ({ supabase: { from: jest.fn(() => ({ upsert: mockUpsert })) } }));

describe("registerForPush", () => {
  const prevFlag = process.env.EXPO_PUBLIC_ENABLE_PUSH;
  beforeEach(() => { process.env.EXPO_PUBLIC_ENABLE_PUSH = "1"; });
  afterAll(() => { process.env.EXPO_PUBLIC_ENABLE_PUSH = prevFlag; });

  it("gets an Expo token and upserts it against device_tokens (push enabled)", async () => {
    const token = await registerForPush("u1");
    expect(token).toBe("ExponentPushToken[test]");
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "u1", token: "ExponentPushToken[test]" }),
      { onConflict: "token" },
    );
  });

  it("returns null on a simulator (no device)", async () => {
    jest.resetModules();
    process.env.EXPO_PUBLIC_ENABLE_PUSH = "1";
    jest.doMock("expo-device", () => ({ isDevice: false }));
    const { registerForPush: reg } = require("../lib/push");
    expect(await reg("u1")).toBeNull();
  });

  it("returns null when push is disabled (EXPO_PUBLIC_ENABLE_PUSH unset)", async () => {
    process.env.EXPO_PUBLIC_ENABLE_PUSH = "0";
    expect(await registerForPush("u1")).toBeNull();
  });
});
