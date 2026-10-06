# Organizer proceeds review

Reviewed the complete change against the investigation and the existing three-party ledger.

- Recorded event net is read through the existing security-invoker aggregate with both organization and event identifiers. It preserves historical settlement amounts and unknown processing fees. Refunds are not subtracted twice.
- Captured registration fees and charged gross include later full refunds; organizer balances keep their existing refund semantics. Group allocations are read separately from legacy payments with shared captures excluded from the legacy query.
- Active-event membership includes open/almost_full/coming_soon and paginates event metadata. It never estimates revenue using current terms.
- The Commission page checks manage_platform before querying; no authorization changes or new privileged database surfaces were introduced.
- React review: existing server components and cards are reused. Independent reads remain parallel under Suspense; no new client state, effect, bundle dependency or inaccessible control was added.
- Regression tests cover missing/invalid net, filtering independence, zero fees, group/legacy rows, full-refund commission, more than 1,000 events, and the existing platform-admin guard.

Code review passed. No blocking technical issues detected. Hosted UI acceptance remains required before production.
