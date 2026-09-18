# Race Pace production services and purchasing checklist

Prepared: 16 September 2026. Scope: runner web application and admin console only.

This is a purchasing and setup plan, not a production-readiness approval. No purchases or subscriptions were made while preparing it. Prices are public USD list prices unless stated otherwise. Confirm checkout prices, tax, renewal rates and usage charges before buying.

## Recommended shopping list

| Priority | Requirement | Recommendation | Budget | Current position / action |
| --- | --- | --- | --- | --- |
| Required for branded launch and email | Domain name | One domain you own; use Cloudflare Registrar if it supports your chosen extension, or another established registrar | Annual quote for the exact name; availability and renewal price not checked | Ownership not confirmed. Buy one domain, not separate domains for web and admin. |
| Required hosting | Vercel | Pro team hosting both existing projects | $20/month starting platform fee, including one deploying seat; usage and extra seats can add charges | Both apps already deployed. Check the existing team plan before purchasing another subscription. |
| Required backend; paid tier recommended for production | Supabase | Pro with the existing project | From $25/month for one Micro project within included allowances | Existing database, Auth, Storage and Edge Functions. Confirm billing tier and upgrade the existing organization if needed. |
| Required outbound email | Resend | Free during configuration; budget Pro for event registration bursts | Free: 3,000/month, 100/day. Pro: $20/month for 50,000 emails | Account/subscription not yet set up. Our ticket transport already supports Resend. Configure both Auth SMTP and ticket API delivery. |
| Required for paid registrations | PayMongo | Approved live merchant account, enabled payment methods and signed webhooks | Standard payment service has no setup/monthly fee; transaction fees apply | Test integration exists. Live activation, account-specific fees, webhook delivery and settlement still need verification. |
| Required for receiving settlements | Settlement bank account | An account accepted by PayMongo for the approved merchant entity | Bank-specific fees; confirm with provider | Confirm account ownership, verification and settlement destination. Organizer payout instructions also need verification. |
| Required support channel; separate purchase optional | Monitored support inbox | Use an existing business mailbox initially; otherwise choose Google Workspace or Microsoft 365 | Existing inbox: potentially no incremental cost; new mailbox priced separately | Decide who receives support and refund questions. A verified sending address alone is not an operational support inbox. |

Sources: [Vercel Pro pricing](https://vercel.com/docs/plans/pro-plan), [Vercel commercial-use guidance](https://vercel.com/pricing), [Supabase pricing](https://supabase.com/pricing), [Resend pricing](https://resend.com/docs/knowledge-base/what-is-resend-pricing), [PayMongo pricing](https://www.paymongo.com/en/pricing), [Cloudflare domain registration](https://developers.cloudflare.com/registrar/get-started/register-domain/).

Vercel Hobby is for personal, non-commercial use. Budget Pro for this organizer marketplace even during a zero-commission pilot. Two Vercel projects do not automatically mean two Pro subscriptions; both currently belong to one team.

Supabase Pro is a production recommendation, not a technical requirement to run the code. Free projects can pause after low activity over seven days. Pro includes daily database backups with seven-day retention. Additional projects and larger compute increase the budget. [Pausing policy](https://supabase.com/docs/guides/platform/free-project-pausing)

## Expected recurring budget

Assumes one Vercel deploying seat, one Supabase Micro project, included usage and no paid add-ons. These are total service costs, not necessarily new spending if you already subscribe.

| Scenario | Vercel | Supabase | Resend | Base monthly total |
| --- | ---: | ---: | ---: | ---: |
| Setup / very small controlled pilot | $20 | $25 | $0 | **$45** |
| Recommended email capacity for a paid-event pilot | $20 | $25 | $20 | **$65** |

Add domain renewal, any mailbox subscription, payment-processing charges, taxes, foreign-exchange charges, backup storage and usage overages. This is a baseline, not a fixed-price guarantee.

Plan email volume by messages, not runners. For example, 60 runners receiving one confirmation and one ticket each would generate 120 messages. That already exceeds Resend Free's daily cap before invitations or password resets. Supabase Auth also has separate sending limits that need configuration.

## Domain and email setup

Use one owned domain with subdomains. The following are placeholders, not available names or purchase recommendations:

| Purpose | Example |
| --- | --- |
| Runner site | `your-domain.com` |
| Admin | `admin.your-domain.com` |
| Transactional sender | `tickets@notify.your-domain.com` |
| Human replies | `support@your-domain.com` |

- [ ] Choose and register the domain; check both first-year and renewal prices.
- [ ] Keep ownership in the business-controlled account and enable renewal reminders.
- [ ] Configure domain name system (DNS) records for both Vercel projects.
- [ ] Verify the sending domain in Resend using its requested DNS records.
- [ ] Configure SPF and DKIM email authentication; publish and review a DMARC policy.
- [ ] Configure Resend SMTP in hosted Supabase Auth for confirmations, resets and invitations.
- [ ] Configure `EMAIL_PROVIDER=resend`, `RESEND_API_KEY` and `EMAIL_FROM` in hosted function secrets.
- [ ] Set a working support/reply address in the templates or transport. Verify replies actually reach the inbox; this may need a small code change.
- [ ] Update site URLs, invitation URLs, allowed browser origins and Auth redirect URLs to the chosen domain.
- [ ] Update Google sign-in configuration if retaining that feature.
- [ ] Rebuild both apps after changing public environment variables.
- [ ] Test delivery, links, replies and spam placement with real test inboxes.

One Resend account can serve Auth SMTP and application emails; they are separate integrations. Keep Mailpit for local development. It is not a hosted production delivery service. Supabase's default SMTP is restricted and is not suitable for public runner onboarding. [Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [Resend domain verification](https://resend.com/docs/dashboard/domains/introduction)

## PayMongo activation and organizer funds

- [ ] Complete PayMongo's current merchant onboarding and requested identity/business documentation.
- [ ] Confirm supported payment methods, live API credentials and the live webhook signing secret.
- [ ] Confirm with PayMongo that the approved account arrangement supports collecting for multiple independent organizers.
- [ ] Agree who is the merchant receiving the charge, who receives settlements, and how organizer payouts occur.
- [ ] Ask whether the intended marketplace requires linked merchant accounts or platform products. Obtain a quote if so.
- [ ] Verify the exact account rates, VAT treatment, refund fees and settlement schedule. Update the application's effective fee rates accordingly.
- [ ] Verify callback processing and reconciliation in hosted test mode before a separately authorized small live payment/refund.
- [ ] Confirm organizer payout instructions and document who performs and reconciles transfers.

The application's payout ledger and “Mark paid” action record accounting; they do not prove that a bank transfer occurred. Automatic payment splitting or payouts must not be assumed to exist because PayMongo offers those products. Their activation and integration are separate work. [PayMongo platform pricing](https://www.paymongo.com/en/pricing), [Linked accounts](https://docs.paymongo.com/docs/account-settings-linked-accounts)

Zero platform commission is supported for the pilot, but processing fees still apply. Current public rates should not be copied blindly into the app: PayMongo lists VAT-exclusive rates, while the application's processor-rate table describes VAT-inclusive values. Reconcile the actual merchant contract and provider statements before charging runners.

## Operational services and optional subscriptions

| Service | Need | Purchase decision |
| --- | --- | --- |
| Google sign-in / Google Cloud OAuth client | Conditional: required to keep the existing Google sign-in buttons usable | Configure the OAuth project, consent screen, domains and callback. Do not buy Google Workspace solely to enable app sign-in. Email/password remains a separate option. |
| GitHub repository | Existing source and release history | Keep the existing repository. A new paid GitHub plan is not an application runtime dependency. |
| External uptime alerts | Recommended before pilot; alert an assigned operator | Select a monitoring service and confirm commercial-use terms. A paid plan is not yet required by the code. Monitor both apps and a meaningful backend health signal. |
| Error tracking | Recommended as use grows | Existing Vercel/Supabase logs support initial triage. A service such as Sentry is optional and needs integration; it is not currently a production dependency. |
| Backup storage and restore process | Required operational plan | Use Supabase database backups plus a separate backup of uploaded files. Reuse suitable secure storage or price an object-storage service. Test restoration. |
| Point-in-time database recovery | Optional upgrade based on acceptable data loss | Consider before high-volume paid registrations if daily backup granularity is insufficient. Price the add-on separately. |
| Password manager and account recovery | Recommended operational control | Reuse an existing team solution where available; store secrets there, not in this checklist. |
| Separate hosted staging database | Recommended for ongoing releases; optional purchase for this initial setup | Local Docker remains available. An additional Supabase project adds cost; never run destructive test suites against production. |

Supabase database backups exclude uploaded Storage objects; a database backup alone cannot restore event images or other uploaded files. [Backup coverage](https://supabase.com/docs/guides/platform/backups)

## Do not buy for the current web/admin scope

- Apple Developer, Google Play or Expo build subscriptions: mobile is outside this launch.
- SMS/WhatsApp providers: no required web/admin flow currently depends on them.
- Separate PostgreSQL hosting, authentication subscriptions or primary image storage: Supabase already provides these services.
- A separate virtual server: the current apps use Vercel and Supabase.
- Paid spreadsheet/export software or a QR-generation subscription: current reports and tickets are implemented in the application.
- PayMongo Storefront: Race Pace already provides its own storefront and API checkout.
- Marketing automation, dedicated email IPs, enterprise support or analytics upgrades: defer until a concrete need exists.

## Purchase and activation order

1. Confirm existing Vercel/Supabase billing plans and business ownership to avoid duplicate subscriptions.
2. Select the domain and support inbox.
3. Create Resend, verify the domain and configure both email integrations.
4. Upgrade Vercel/Supabase where necessary and set usage alerts.
5. Complete PayMongo live and marketplace approval; verify the settlement account.
6. Configure backups and operational alerts.
7. Complete the hosted end-to-end checklist before inviting paying runners.

## Procurement tracker

| Item | Selected provider / account owner | Purchased or existing? | Renewal / billing date | Setup verified? |
| --- | --- | --- | --- | --- |
| Domain | TBD | TBD | TBD | No |
| Vercel plan | Existing team; billing to confirm | Existing account | TBD | Apps deployed; plan unverified |
| Supabase plan | Existing organization; billing to confirm | Existing account | TBD | Backend deployed; plan unverified |
| Resend | TBD | Not yet configured | TBD | No |
| Support inbox | TBD | TBD | TBD | No |
| PayMongo live / marketplace approval | Existing account; owner to confirm | Test integration exists | Transaction-based / contract | No |
| Settlement account | TBD | TBD | Bank-specific | No |
| Backups and alerts | TBD | TBD | TBD | No |

Do not put passwords, API keys, bank-account numbers or identity documents in this file.

## Related project records

- [Deployment guide](../deploy-vercel.md)
- [Latest deployment evidence and unresolved blockers](../reports/2026-09-16-hosted-deployment.md)
- [Web/admin end-to-end checklist](../plans/2026-09-15-web-admin-e2e-checklist.md)

Purchasing these services does not finish implementation. Hosted Auth/email verification, security-warning triage and the complete registration-to-payout test remain required.
