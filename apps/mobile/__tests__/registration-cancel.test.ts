const mockSelect = jest.fn().mockResolvedValue({ data: [{ id: "r1" }], error: null });
const mockEq = jest.fn(() => ({ select: mockSelect }));
const mockDelete = jest.fn(() => ({ eq: mockEq }));
jest.mock("../lib/supabase", () => ({
  supabase: { from: jest.fn(() => ({ delete: mockDelete })) },
  FunctionsHttpError: class {},
}));

import { cancelRegistration } from "../lib/registration";
import { supabase } from "../lib/supabase";

describe("cancelRegistration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSelect.mockResolvedValue({ data: [{ id: "r1" }], error: null });
  });

  it("deletes the registration row by id", async () => {
    await cancelRegistration("r1");
    expect(supabase.from).toHaveBeenCalledWith("registrations");
    expect(mockDelete).toHaveBeenCalled();
    expect(mockEq).toHaveBeenCalledWith("id", "r1");
    expect(mockSelect).toHaveBeenCalled();
  });

  it("throws when Supabase returns an error", async () => {
    mockSelect.mockResolvedValueOnce({ data: null, error: { message: "denied" } });
    await expect(cancelRegistration("r1")).rejects.toBeTruthy();
  });

  it("throws when no row was deleted (RLS blocked)", async () => {
    mockSelect.mockResolvedValueOnce({ data: [], error: null });
    await expect(cancelRegistration("r1")).rejects.toBeTruthy();
  });
});
