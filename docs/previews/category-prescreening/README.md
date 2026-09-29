# Category reservations and pre-screening proposal

Interactive HTML milestone for owner approval. No application or backend integration.

Run `python3 -m http.server 4179 --bind 127.0.0.1` from this directory. Open http://127.0.0.1:4179/ . Open `responsive.html` for native 390px, 768px, and 1280px review frames.

## Review path

1. **Event setup:** edit category capacity; toggle reservations and pre-screening; edit deadlines, requirements, and inclusions. Event capacity derives from category totals.
2. **Event page:** use Preview states to switch Coming Soon/open. Compare category actions and inclusions.
3. **Pre-screening:** select own/managed Passports and mixed categories. Add a local image or use illustrative proof. An explanation is optional. No payment choice appears in this form; submitting secures every selected slot without payment. The originating category action retains the later checkout route.
4. **My request:** submit to simulate held slots. Nothing is held before submission. Pending participants block the group payment.
5. **Approvals:** search/filter, view/zoom proof, approve one participant, and reject another with a reason. Return to My request to see the remaining participant's payment and the rejected participant's alternative-category route.
6. **Emails:** review approval, rejection, and payment reminder messages.

Preview states also exposes partial approval, ready-to-pay, expiry, no capacity, conflicting deadline, failed email delivery, and empty queue. Use the proof validation controls on Pre-screening for exact 10 MB, oversized, unsupported, and invalid-image fixtures. They call the same local validator as the file input.

## Boundaries

All data lives in memory and resets on reload. Proof images are read locally. No storage, authenticated links, provider checkout, email, durable hold, or server authorization exists here. File-read progress represents local preparation, not a resumable network upload. The clock is fixed at 1 October 2026, 09:00 Asia/Manila. Expired state illustrates a hold already reconciled and released; it does not implement reconciliation.

The photo and logo reuse existing Race Pace assets. Sample certificates are visibly illustrative. Storybook contains a synchronized snapshot under `projects/race-pace/src/proposals/category-prescreening/`; update the three source files and assets together when revising this proposal.

Approval covers visual structure and interactions only. Atomic capacity, authorization, pricing snapshots, storage policies, deadlines, provider reconciliation, and migration safety require the application phase and staging acceptance.
