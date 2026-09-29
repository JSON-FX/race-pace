# Execution report: category reservations and pre-screening

Overall implementation status: partial, as required by the prototype-first milestone. HTML prototype is ready for review; application implementation is pending design approval.

## Files and scope

Created an isolated worktree at current staging `5a53ba7`, branch `codex/category-prescreening-prototype`. Added `docs/previews/category-prescreening/`, the plan/spec, and progress entries. Added only the new `category-prescreening` proposal folder to the separate Storybook Hub. Preserved unrelated working-tree edits. No application source, migration, hosted configuration, payment, email or production record was changed.

## Browser verification

Primary Codex browser tooling was used. No Playwright plugin fallback was used.

Passed:
- Category allocation cannot exceed total; 70K capacity 110 updates event sum to 260. Save and disclosure toggles work.
- Missing per-Passport proof blocks submission. Illustrative proof and optional explanation submit into held status.
- Own and managed Passports have independent decisions. Partial approval keeps payment disabled.
- Rejecting Mika with a reason releases only Mika; Alex's entry payment contains only Alex/70K. Mika can independently choose 21K.
- Mixed 70K/21K reservation request requires proof only for 70K; approving it enables one checkout totaling PHP 500 + PHP 300 = PHP 800.
- Proof viewer and zoom work. Escape closes checkout and restores focus to Pay reservation fees. Added explicit dialog Tab/Shift+Tab cycling; verified Close → Shift+Tab → Approve Alex → Tab → Close, with Escape returning to Review proof.
- Deadline conflict disables approval with extension guidance. Expired payment disables checkout.
- Approval email resend simulation retains the same Oct 4, 09:00 PHT deadline.
- Coming Soon category actions retain reservations; ordinary 21K entry is disabled. Capacity-unavailable state prevents new actions.
- Shared local upload validator accepts a 10,000,000-byte image and rejects 10,000,001 bytes, invalid image content, and unsupported type via generated preview fixtures.
- Desktop review plus native 390px and 768px iframe review. Mobile navigation sizing corrected. Reduced-motion media rule inspected; allocation layout animation removed.

Limitations:
- Direct interaction with the visually clipped file input did not open the chooser. Using its visible label resolved this. Actual file-picker tests then accepted the exact 10,000,000-byte PNG and rejected oversized, invalid-content and unsupported files.
- Browser viewport override produced corrupted screenshots and a mismatched CSS width. Reset it and used native-sized iframes instead; those rendered correctly.
- No network upload, interrupted/resumable transfer, server validation, tenant authorization or backend hold was tested. Those do not exist in this HTML milestone.
- No system reduced-motion preference was changed; the CSS rule is verified by inspection, not an operating-system preference test.

## Static and catalog validation

- `node --check docs/previews/category-prescreening/prototype.js`: pass.
- Storybook Hub `pnpm typecheck`: pass across seven packages/projects.
- Storybook Hub `pnpm build:all`: pass across four catalogs; existing dependency/chunk-size warnings remain. Docker catalog rebuilt; served Event Setup and Ready To Pay stories read back successfully. Fixed srcdoc initialization to use in-memory screen navigation instead of History API rewriting.
- Impeccable detection found one allocation width-transition warning and one dialog shadow advisory. Removed both patterns. Existing Fieldnotes borders/radii retained.
- Console review exposed selectors beginning with numeric category IDs. Added CSS identifier escaping and rechecked derived totals, validation, save, and disclosure.

Owner clarification verified: “Request reservation review” opens proof submission, not payment. Reservation payment remained disabled after Alex alone was approved and became enabled only after Mika was also approved. The event copy and form now explicitly state that reservation payment is locked until approval.

## Required next gates

1. Owner review/approval of the HTML proposal.
2. Additive implementation with existing-event compatibility, private proof, atomic ownership, backend admission and fixed deadlines.
3. Full local CI-equivalent checks and review, then exact-revision hosted staging acceptance.
4. Production baseline/recovery verification and staging → main promotion only after all required checks pass.

The earlier production inventory is planning evidence only and must be repeated before release.

## Annotation revision

Removed decorative status dots across the proposal and removed pre-screening payment-option controls. Pending review now displays all participant slot holds and PHP 0 due. Categories without requirements display “No review needed”; these participants wait with the group without entering the pending organizer queue.

Browser verification: submitted Alex/70K plus managed Mika/21K with only Alex proof. Both slots held, PHP 0 due, payment disabled, one organizer review. Approving Alex enabled the unchanged PHP 5,000 group entry route and 72-hour window. The reverse configuration is also included as a dedicated preview and Storybook scenario. Application code and hosted Race Pace environments remain unchanged.

Revision validation: the reverse case (Alex/21K, managed Mika/70K) also held both slots with PHP 0 due and enabled group payment only after Mika was approved. Zero decorative badge dots were found on runner, approval, and status screens. Mobile proof form contains zero payment radio controls. Storybook typecheck and Docker build (including all four catalog builds) passed after this revision.
