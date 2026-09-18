# Provider-calculated PayMongo fees

Status: implementation in progress. Scope: runner web checkout, admin financial ledger, and the gated group-payment backend. Production deployment is excluded until staging validation passes.

The current pilot pricing decision is **fixed advertised price**. A ₱100 entry costs the runner ₱100 regardless of payment method. Race Pace's commission and PayMongo's actual processing fee are deductions from that gross payment. The organizer receives the remainder. The existing `pass_on` branch is retained for historical rows and separate future approval; it is not the pilot configuration.

## Contract

- For `absorb`, the runner pays the advertised entry and add-on total. The frozen Race Pace fee and PayMongo's actual captured fee both reduce organizer net. No locally configured processor rate can change the runner's price or the actual ledger fee.
- For `pass_on`, Race Pace sends entry total plus the frozen Race Pace platform fee to PayMongo `/v2/checkout_sessions` with `pass_on_fees: true`. PayMongo computes and displays its processing fee after the runner selects a method. Race Pace does not predict or add that fee to the charge.
- Race Pace's pre-redirect screen shows entry and the Race Pace fee. It says the processing fee and final total will appear on PayMongo. It never labels a local estimate as an actual processor fee.
- A registration has one active PayMongo session. A failed call must not fall back to an unverified stored session. The checkout's fee mode and platform fee are frozen when its session is created.
- A payment is confirmed only from a captured provider payment with integer `amount`, `fee`, and `net_amount` satisfying `amount - fee = net_amount`. For pass-on, `net_amount` must equal entry plus frozen platform fee. If these figures are absent or inconsistent, retain the pending payment for reconciliation and do not mint a ticket or payout.
- On confirmation, store the provider's actual gross, processor fee, and organizer net as integer centavos. Refunds, settlements, exports, and payouts read those stored amounts and refund records, never a rate-card recomputation. Replays must remain idempotent.
- Existing paid historical rows remain unchanged. Any rate card remains advisory for legacy pricing and drift analysis only.
- A captured `absorb` payment whose gross differs from the advertised total must not issue a ticket or payout. It requires investigation and refund or correction. Chargeable sessions must be explicitly expired when their reservation is cancelled, replaced, or expires; this lifecycle and durable reconciliation are launch blockers.
- "Taxes and fees" is a display label for the included Race Pace deduction. It does not by itself calculate or establish a tax obligation. Tax treatment requires separate accounting and legal review before launch.

## Group checkout

The group feature is currently gated off. Before enabling it, use one `/v2` session for the order and let PayMongo add processing fees. Freeze the entry and platform-fee allocation per participant. Allocate the provider's actual extra gross and actual processing fee across participants with deterministic centavo rounding. The allocation totals must equal the captured payment exactly. Missing provider figures or an unexpected provider net must enter `reconciliation_required`, with no ticket, slot consumption, or payout allocation.

## Validation

Test fixed-price GCash, Maya, and card in PayMongo test mode, including a failed attempt followed by another method. For each capture, compare PayMongo's displayed total, webhook payment, ledger, ticket, refund preview, reports, exports, and organizer settlement. Confirm duplicate webhooks and callbacks do not duplicate payments or tickets. Test a changed provider fee in fixtures without changing app configuration. Keep production pass-on unavailable unless separately approved and validated.

References: [PayMongo Hosted Checkout](https://docs.paymongo.com/docs/payment-channels-hosted-checkout), [Create checkout session v2](https://docs.paymongo.com/reference/create_checkout_sessions_2), [Get checkout session](https://docs.paymongo.com/reference/get_checkout_sessions).
