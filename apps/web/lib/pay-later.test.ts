import { describe, expect, it } from "vitest";
import { philippineDay, shiftPayLaterDay, validPayLaterDay, payLaterStatus, type PayLaterGrant } from "./pay-later";
const row = {due_at:"2027-02-21T16:00:00Z",registration_status:null,paid_with_pay_later:false} as PayLaterGrant;
describe("Pay Later display boundaries",()=>{
 it("uses Philippine calendar dates across UTC midnight",()=>{
   expect(philippineDay(new Date("2027-02-10T16:00:00Z"))).toBe("2027-02-11");
   expect(shiftPayLaterDay("2027-03-21",-28)).toBe("2027-02-21");
 });
 it("rejects impossible dates and preserves leap days",()=>{
   expect(validPayLaterDay("2027-02-29")).toBe(false);
   expect(validPayLaterDay("2028-02-29")).toBe(true);
 });
 it("expires at the exclusive boundary",()=>{
   expect(payLaterStatus(row,Date.parse(row.due_at)-1)).toBe("Eligible");
   expect(payLaterStatus(row,Date.parse(row.due_at))).toBe("Expired");
 });
 it("distinguishes a pending provider reconciliation from a released ticket",()=>{
   const pending={...row,paid_with_pay_later:true,registration_status:"pending"};
   expect(payLaterStatus(pending,Date.parse(row.due_at))).toBe("Deadline passed");
   expect(payLaterStatus({...pending,registration_status:"expired"})).toBe("Expired");
 });
 it("distinguishes ordinary payments",()=>{
   expect(payLaterStatus({...row,registration_status:"paid"})).toBe("Paid separately");
   expect(payLaterStatus({...row,registration_status:"paid",paid_with_pay_later:true})).toBe("Paid");
 });
});
