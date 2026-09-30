# Reservations page review

Scoped review of the approved event-specific Reservations implementation. Full new route, client composition, query, CSS, loading/error boundaries, permissions, legacy redirect, navigation, event/payment links, and Registrations composition were read.

No migration, function, provider, dependency, privileged client, or payment mutation is included. Queries use the authenticated client, explicit organization/event filters, bounded complete header/profile reads, and payment ledger values in integer centavos. Membership validation precedes roster reads even for super admins. Keyed client state resets on organization/event changes. Paid checkouts and collected money are counted once, including conversions. Ended checkout windows and review-required captures are not awaiting-payment counts. Missing payments/categories remain explicit.

Existing event reservation links redirect with the same capability and active organization checks. Pre-screening remains on Registrations; its embedded early-reservation section is removed. Search/payment filters and pagination only affect the roster. Event-wide summaries remain fixed. Failure throws to a recoverable error boundary rather than becoming zero totals.

Fresh design review accepted captured light desktop/mobile fidelity and required a dark surface correction. Semantic table/header, paid/amber badges, and avatar pairs resolved that finding. The reviewer scored the correction resolved with disposition ship; that verdict covers the named correction only. Loading/error boundaries are present. The official shadcn Alert replaced a native custom alert after the Fieldnotes source audit identified it.

Actual localhost authenticated nested query rendered one paid checkout and PHP 211.28. Search with no matches preserved all four summary figures. Browser showed all eight desktop columns and all labeled phone fields at 390 CSS pixels without horizontal overflow. Dark desktop and phone captures show readable table, status, and avatar. No provider transaction or hosted fixture was performed.

Admin typecheck passed. Fieldnotes audit: 324 current modules, 256 audited, zero native/dedicated sites and zero duplicate primitives. Additional local test suites are explicitly waived by the owner for urgent release; updated existing assertions preserve intentional behavior. Production build, integrated revision compilation, required GitHub checks, and hosted deployment readback remain release gates.

No unresolved scoped source finding. Large event metadata is intentionally loaded in bounded pages, then filtered locally; server pagination/aggregation is an upgrade when measured event volume requires it.
