import { beforeEach, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { render, screen } from "@testing-library/react";
import { CallbackPanel } from "./CallbackPanel";
const state=vi.hoisted(()=>({query:"rid=known-registration&status=paid", data:null as null | {status:string;expiresAt:string|null;payLaterDueAt:string}, verify:vi.fn(), refetch:vi.fn()}));
vi.mock("next/navigation",()=>({useRouter:()=>({replace:vi.fn()}),useSearchParams:()=>new URLSearchParams(state.query)}));
vi.mock("@/lib/registration",()=>({useRegistration:()=>({data:state.data,refetch:state.refetch}),verifyPayment:state.verify}));
it("renders confirmation immediately when PayMongo supplies a registration",()=>{
 state.query="rid=known-registration&status=paid";
 const html=renderToString(<CallbackPanel />);
 expect(html).toContain("Confirming your payment"); expect(html).not.toContain("We lost track");
});
it("waits for browser storage before declaring a missing payment",()=>{
 state.query="status=paid";
 const html=renderToString(<CallbackPanel />);
 expect(html).toContain("Locating your registration"); expect(html).not.toContain("We lost track");
});
it("explains a captured payment under review and prevents another payment attempt",async()=>{
 state.query="rid=known-registration&status=paid";
 state.verify.mockResolvedValue({status:"review_required"});
 state.refetch.mockResolvedValue(undefined);
 render(<CallbackPanel />);
 expect(await screen.findByRole("heading",{name:"Payment needs review"})).toBeTruthy();
 expect(screen.getByText(/No race pass has been issued/)).toBeTruthy();
 expect(screen.getByText(/Please do not pay again/)).toBeTruthy();
 expect(screen.getByRole("link",{name:"View My Races"}).getAttribute("href")).toBe("/races");
});


beforeEach(()=>{state.data=null;});
it("shows an expired payment return without claiming the slot remains held",()=>{
 state.query="rid=known-registration&status=cancel";
 state.data={status:"pending",expiresAt:"2000-01-01T00:00:00Z",payLaterDueAt:"2000-01-01T00:00:00Z"};
 render(<CallbackPanel />);
 expect(screen.getByRole("heading",{name:"Payment window closed"})).toBeInTheDocument();
 expect(screen.queryByRole("link",{name:"Back to payment"})).not.toBeInTheDocument();
 expect(screen.queryByText(/slot is still held/)).not.toBeInTheDocument();
});
it("does not blame the deadline when a deferred entry was closed early",()=>{
 state.query="rid=known-registration&status=cancel";
 state.data={status:"expired",expiresAt:null,payLaterDueAt:"2099-01-01T00:00:00Z"};
 render(<CallbackPanel />);
 expect(screen.getByText(/can no longer be paid/)).toBeInTheDocument();
 expect(screen.queryByText(/deadline passed/)).not.toBeInTheDocument();
});
