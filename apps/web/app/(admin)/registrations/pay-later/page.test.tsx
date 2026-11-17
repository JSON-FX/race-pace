import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ roles: vi.fn(), events: vi.fn(), grants: vi.fn(), redirect: vi.fn((path:string) => { throw new Error(path); }) }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/queries/roles", () => ({ getMyRoles: mocks.roles, requireOrgId: (roles: {orgId:string|null}) => roles.orgId }));
vi.mock("@/lib/queries/pay-later", () => ({ getPayLaterEvents: mocks.events, getPayLaterGrants: mocks.grants }));
vi.mock("./pay-later-manager", () => ({ PayLaterManager: () => null }));
import Page from "./page";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.roles.mockResolvedValue({isOrgAdmin:true,orgId:"org-1"});
  mocks.events.mockResolvedValue([{id:"event-1",name:"Ridge",event_date:"2027-03-21",status:"open"}]);
  mocks.grants.mockResolvedValue({rows:[],total:0});
});
it("redirects editors and anonymous users before reading events", async () => {
  mocks.roles.mockResolvedValue({isOrgAdmin:false,isAdmin:true,orgId:"org-1"});
  await expect(Page({searchParams:Promise.resolve({})})).rejects.toThrow("/no-access");
  expect(mocks.events).not.toHaveBeenCalled();
});
it("keeps a super admin without active organization in the organization chooser", async () => {
  mocks.roles.mockResolvedValue({isOrgAdmin:true,orgId:null});
  await Page({searchParams:Promise.resolve({})});
  expect(mocks.events).not.toHaveBeenCalled();
});
it("does not read grants for an event outside the active organization", async () => {
  await Page({searchParams:Promise.resolve({event:"foreign-event"})});
  expect(mocks.events).toHaveBeenCalledWith("org-1");
  expect(mocks.grants).not.toHaveBeenCalled();
});
it("loads grants for the explicitly selected scoped event", async () => {
  await Page({searchParams:Promise.resolve({event:"event-1"})});
  expect(mocks.grants).toHaveBeenCalledWith("event-1");
});
