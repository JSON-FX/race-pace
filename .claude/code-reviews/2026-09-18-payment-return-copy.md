# Payment return and fee disclosure review

Scope: `apps/site/app/pay/callback/CallbackPanel.tsx` payment-return text and `apps/site/components/RefundNotice.tsx` fee terminology. Existing unrelated working-tree edits were not part of this review.

Files modified: 2. Files added: 0. Files deleted: 0. No technical issues found in the scoped change.

The same PayMongo `cancel_url` can be used after a voluntary exit or a failed attempt. “Payment not completed” avoids falsely identifying the cause or asserting that no money was taken. The refund notice names the Race Pace fee and explains its “Taxes and fees” display label when charged to the runner. It does not claim that tax calculation has been implemented.

Validation: site typecheck passed; focused tests passed (8); full site suite passed (393); `git diff --check` passed. Vercel staging site `dpl_7xLbsz6iY5eXG9P3ZHEHkKwxj8yp` is Ready. In-app browser confirmed both revised messages on staging and the existing Back to payment link.

Open: PayMongo's GCash expired-source exit experience and a successful retry after failure still need live verification. No production release is approved by this review.
