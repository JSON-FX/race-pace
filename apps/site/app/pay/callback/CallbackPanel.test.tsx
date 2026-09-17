import { expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { CallbackPanel } from "./CallbackPanel";
const state=vi.hoisted(()=>({query:"rid=known-registration&status=paid"}));
vi.mock("next/navigation",()=>({useRouter:()=>({replace:vi.fn()}),useSearchParams:()=>new URLSearchParams(state.query)}));
vi.mock("@/lib/registration",()=>({useRegistration:()=>({data:null,refetch:vi.fn()}),verifyPayment:vi.fn()}));
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
