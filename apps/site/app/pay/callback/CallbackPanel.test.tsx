import { expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { render, screen } from "@testing-library/react";
import { CallbackPanel } from "./CallbackPanel";
const state=vi.hoisted(()=>({query:"rid=known-registration&status=paid", verify:vi.fn(), refetch:vi.fn()}));
vi.mock("next/navigation",()=>({useRouter:()=>({replace:vi.fn()}),useSearchParams:()=>new URLSearchParams(state.query)}));
vi.mock("@/lib/registration",()=>({useRegistration:()=>({data:null,refetch:state.refetch}),verifyPayment:state.verify}));
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
