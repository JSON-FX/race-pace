# Local sandbox checkout loses its return URL

Browser reproduction on 2026-09-15: runner registration c7b6b89a-88ad-4805-9705-cac7a527dff3 reached Payment, but Pay opened `fake-checkout?rid=...` and HTTP 400 “Invalid checkout link”. No GitHub issue was supplied.

Assessment: medium severity (all local simulated checkout blocked), low complexity (provider URL construction), high confidence (browser and source agree).

Root cause: payment-session/index.ts:28 reads the return URL and :192 passes it into the provider. _shared/payments.ts:21 drops it. fake-checkout/index.ts:34-36 requires it. This contract mismatch was introduced in ae6fe04b5b6f477665d46b57befa278c5077a27c on July 20. Existing backend tests manually supply the missing parameter, bypassing the broken handoff.

Implementation: encode registration ID and return URL in FakePaymentProvider. Add provider regression coverage for nested web queries and custom schemes. Keep the real-provider guard unchanged. Validate with the focused unit tests and repeat browser Pay through the application-generated URL. Existing return-target HTML escaping is a separate issue; this change only repairs URL transport.

Scope: local sandbox only; no real payment verification or hosted deployment is implied. No commit or publication requested.
