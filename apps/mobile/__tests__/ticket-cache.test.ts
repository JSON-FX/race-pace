jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"));

import AsyncStorage from "@react-native-async-storage/async-storage";
import { cacheTicket, getCachedTicket, cacheMyRaces, getCachedMyRaces, clearTicketCache, type CachedTicket } from "../lib/ticketCache";

const t: CachedTicket = { rid: "r1", token: "abc.def", eventName: "Apo Sky Ultra 2026", categoryLabel: "21K", runnerName: "Juan", status: "paid", orgId: "o1" };

describe("ticketCache", () => {
  beforeEach(async () => { await clearTicketCache(); });

  it("caches and reads a ticket", async () => {
    await cacheTicket(t);
    expect(await getCachedTicket("r1")).toEqual(t);
  });

  it("caches a my-races list and fans out paid tickets", async () => {
    await cacheMyRaces([t]);
    expect(await getCachedMyRaces()).toEqual([t]);
    expect(await getCachedTicket("r1")).toEqual(t);
  });

  it("clearTicketCache removes ticket: and myraces: keys", async () => {
    await cacheTicket(t);
    await cacheMyRaces([t]);
    await clearTicketCache();
    expect(await getCachedTicket("r1")).toBeNull();
    expect(await getCachedMyRaces()).toEqual([]);
  });

  it("leaves non-ticket keys (e.g. session, selected org) untouched", async () => {
    await AsyncStorage.setItem("sb-localhost-auth-token", "session-blob");
    await AsyncStorage.setItem("selected_org_id", "o1");
    await cacheTicket(t);
    await clearTicketCache();
    expect(await getCachedTicket("r1")).toBeNull();
    expect(await AsyncStorage.getItem("sb-localhost-auth-token")).toBe("session-blob");
    expect(await AsyncStorage.getItem("selected_org_id")).toBe("o1");
  });
});
