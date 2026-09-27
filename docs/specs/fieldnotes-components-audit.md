# Fieldnotes component audit and replacement checklist

Baseline: `1188768f33ea4999407774c15fc3146d8e72cc25`. The immutable JSON contains 256 audited modules and 1443 recognized UI expressions.

Implementation reconciliation: 295 current modules, zero unresolved recognized native/dedicated controls, zero duplicated primitives. All 63 catalog entries have a final disposition. The JSON records owner, source line, consumers, target, findings, compatibility and verification.

The scanner inventories recognized JSX controls and imported primitives. Decorative spans, section wrappers and artwork require manual source review; a zero count does not prove visual or behavioral correctness. Application verification is recorded separately in [the validation report](./fieldnotes-components-verification.md).

## Source checklist

| Owner | Source | Baseline candidates | Final disposition |
|---|---|---:|---|
| runner | `apps/site/app/auth/captcha/page.tsx` | 1 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/app/auth/recovery/page.tsx` | 10 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/app/bookings/page.tsx` | 9 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/app/coming-soon/HorizonScene.tsx` | 0 | Preserved domain renderer, section or route wrapper |
| runner | `apps/site/app/coming-soon/page.tsx` | 0 | Preserved domain renderer, section or route wrapper |
| runner | `apps/site/app/events/EventFilters.tsx` | 5 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/app/events/FieldnotesEventCard.tsx` | 0 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/app/events/FieldnotesHero.tsx` | 0 | Preserved domain renderer, section or route wrapper |
| runner | `apps/site/app/events/[id]/loading.tsx` | 10 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/app/events/[id]/page.tsx` | 0 | Preserved domain renderer, section or route wrapper |
| runner | `apps/site/app/events/loading.tsx` | 10 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/app/events/page.tsx` | 0 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/app/forgot-password/page.tsx` | 6 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/app/group/callback/page.tsx` | 0 | Preserved domain renderer, section or route wrapper |
| runner | `apps/site/app/group/order/[orderId]/GroupOrder.tsx` | 37 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/app/group/order/[orderId]/page.tsx` | 0 | Preserved domain renderer, section or route wrapper |
| runner | `apps/site/app/home/page.tsx` | 0 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/app/inquiry/page.tsx` | 0 | Preserved domain renderer, section or route wrapper |
| runner | `apps/site/app/landing-options/[concept]/page.tsx` | 0 | Preserved domain renderer, section or route wrapper |
| runner | `apps/site/app/landing-options/page.tsx` | 0 | Preserved domain renderer, section or route wrapper |
| runner | `apps/site/app/layout.tsx` | 1 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/app/organizers/OrganizerDirectory.tsx` | 3 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/app/organizers/[slug]/page.tsx` | 0 | Preserved domain renderer, section or route wrapper |
| runner | `apps/site/app/organizers/page.tsx` | 0 | Preserved domain renderer, section or route wrapper |
| runner | `apps/site/app/page.tsx` | 0 | Preserved domain renderer, section or route wrapper |
| runner | `apps/site/app/pay/[registrationId]/PayPanel.tsx` | 8 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/app/pay/[registrationId]/page.tsx` | 0 | Preserved domain renderer, section or route wrapper |
| runner | `apps/site/app/pay/callback/CallbackPanel.tsx` | 4 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/app/pay/callback/page.tsx` | 0 | Preserved domain renderer, section or route wrapper |
| runner | `apps/site/app/profile/PassportEditor.tsx` | 32 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/app/profile/PassportPhotos.tsx` | 5 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/app/profile/PhotoFramer.tsx` | 7 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/app/profile/ProfileForm.tsx` | 3 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/app/profile/ShippingAddress.tsx` | 8 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/app/profile/loading.tsx` | 5 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/app/profile/page.tsx` | 0 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/app/providers.tsx` | 0 | Preserved domain renderer, section or route wrapper |
| runner | `apps/site/app/races/RacesList.tsx` | 17 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/app/races/loading.tsx` | 11 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/app/races/page.tsx` | 0 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/app/register/[categoryId]/GroupRegister.tsx` | 26 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/app/register/[categoryId]/ParticipantPicker.tsx` | 0 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/app/register/[categoryId]/RegisterWizard.tsx` | 31 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/app/register/[categoryId]/group/page.tsx` | 0 | Preserved domain renderer, section or route wrapper |
| runner | `apps/site/app/register/[categoryId]/loading.tsx` | 8 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/app/register/[categoryId]/page.tsx` | 0 | Preserved domain renderer, section or route wrapper |
| runner | `apps/site/app/reservations/[id]/ReservationStatusPanel.tsx` | 2 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/app/reservations/[id]/page.tsx` | 0 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/app/reservations/callback/page.tsx` | 0 | Preserved domain renderer, section or route wrapper |
| runner | `apps/site/app/sign-in/SignInForm.tsx` | 6 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/app/sign-in/page.tsx` | 0 | Preserved domain renderer, section or route wrapper |
| runner | `apps/site/app/sign-up/page.tsx` | 5 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/app/ticket/[registrationId]/TicketPanel.tsx` | 6 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/app/ticket/[registrationId]/loading.tsx` | 6 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/app/ticket/[registrationId]/page.tsx` | 0 | Preserved domain renderer, section or route wrapper |
| runner | `apps/site/components/AccountSectionNav.tsx` | 1 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/components/DynamicField.tsx` | 5 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/components/EventCard.tsx` | 0 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/components/FeaturedRace.tsx` | 0 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/components/GoogleButton.tsx` | 1 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/components/NavProgress.tsx` | 0 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/components/ParallaxMedia.tsx` | 0 | Preserved domain renderer, section or route wrapper |
| runner | `apps/site/components/PaymentLogos.tsx` | 0 | Preserved domain renderer, section or route wrapper |
| runner | `apps/site/components/PillSelect.tsx` | 1 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/components/RaceKitCard.tsx` | 2 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/components/RaceRail.tsx` | 0 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/components/RefundNotice.tsx` | 0 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/components/RunnerTabBar.tsx` | 0 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/components/RunnerTabBarSlot.tsx` | 0 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/components/SeasonBand.tsx` | 0 | Preserved domain renderer, section or route wrapper |
| runner | `apps/site/components/ShirtSizeSheet.tsx` | 5 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/components/SiteFooter.tsx` | 0 | Preserved domain renderer, section or route wrapper |
| runner | `apps/site/components/SiteHeader.tsx` | 0 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/components/SiteNav.tsx` | 1 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/components/StatusBadge.tsx` | 0 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/components/StepRail.tsx` | 0 | Preserved domain renderer, section or route wrapper |
| runner | `apps/site/components/TicketCard.tsx` | 0 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/components/TicketStub.tsx` | 0 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/components/TopoPattern.tsx` | 0 | Preserved domain renderer, section or route wrapper |
| runner | `apps/site/components/TurnstileWidget.tsx` | 2 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/components/event/ComingSoonEventPage.tsx` | 17 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/components/event/CourseMap.tsx` | 1 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/components/event/EventPageBody.tsx` | 3 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/components/event/motion-primitives.tsx` | 0 | Preserved domain renderer, section or route wrapper |
| runner | `apps/site/components/event/sections.tsx` | 2 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/components/landing/CourseAtlas.tsx` | 1 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/components/landing/CourseAtlasMedia.tsx` | 0 | Preserved domain renderer, section or route wrapper |
| runner | `apps/site/components/landing/LandingBackdrop.tsx` | 0 | Preserved domain renderer, section or route wrapper |
| runner | `apps/site/components/landing/LandingShared.tsx` | 6 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/components/landing/OrganizerSignup.tsx` | 16 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/components/landing/PaceTogether.tsx` | 0 | Preserved domain renderer, section or route wrapper |
| runner | `apps/site/components/landing/RidgeSignal.tsx` | 0 | Preserved domain renderer, section or route wrapper |
| runner | `apps/site/components/landing/StartLine.tsx` | 0 | Preserved domain renderer, section or route wrapper |
| runner | `apps/site/components/landing/TrailJournal.tsx` | 0 | Preserved domain renderer, section or route wrapper |
| runner | `apps/site/components/organizers/OrganizerMedia.tsx` | 0 | Preserved domain renderer, section or route wrapper |
| runner | `apps/site/components/organizers/TrailAtlas.tsx` | 0 | Preserved domain renderer, section or route wrapper |
| runner | `apps/site/components/registration/RaceBib.tsx` | 1 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/components/registration/TrailRosterParticipantSelector.tsx` | 15 | Migrated primitives; dedicated workflow retained |
| runner | `apps/site/components/ui/alert-dialog.tsx` | 0 | Shared reexport or dedicated shared composition |
| runner | `apps/site/components/ui/badge.tsx` | 0 | Shared reexport or dedicated shared composition |
| runner | `apps/site/components/ui/button.tsx` | 0 | Shared reexport or dedicated shared composition |
| runner | `apps/site/components/ui/card.tsx` | 0 | Shared reexport or dedicated shared composition |
| runner | `apps/site/components/ui/checkbox.tsx` | 0 | Shared reexport or dedicated shared composition |
| runner | `apps/site/components/ui/dialog.tsx` | 1 | Shared reexport or dedicated shared composition |
| runner | `apps/site/components/ui/input.tsx` | 1 | Shared reexport or dedicated shared composition |
| runner | `apps/site/components/ui/item.tsx` | 1 | Shared reexport or dedicated shared composition |
| runner | `apps/site/components/ui/label.tsx` | 0 | Shared reexport or dedicated shared composition |
| runner | `apps/site/components/ui/rainbow-button.tsx` | 0 | Shared reexport or dedicated shared composition |
| runner | `apps/site/components/ui/select.tsx` | 0 | Shared reexport or dedicated shared composition |
| runner | `apps/site/components/ui/separator.tsx` | 0 | Shared reexport or dedicated shared composition |
| runner | `apps/site/components/ui/skeleton.tsx` | 0 | Shared reexport or dedicated shared composition |
| admin | `apps/web/app/(admin)/check-in/event-switcher.tsx` | 2 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/(admin)/check-in/history.tsx` | 3 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/(admin)/check-in/loading.tsx` | 9 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/(admin)/check-in/page.tsx` | 6 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/(admin)/check-in/roster.tsx` | 39 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/(admin)/check-in/scanner.tsx` | 3 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/(admin)/checkout-reviews/capture-review-table.tsx` | 15 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/(admin)/checkout-reviews/page.tsx` | 2 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/(admin)/checkout-reviews/review-table.tsx` | 19 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/(admin)/commission/fee-mode-row.tsx` | 6 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/(admin)/commission/loading.tsx` | 12 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/(admin)/commission/page.tsx` | 38 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/(admin)/commission/reservation-terms-table.tsx` | 9 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/(admin)/commission/terms-row.tsx` | 55 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/(admin)/dashboard/loading.tsx` | 17 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/(admin)/dashboard/page.tsx` | 20 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/(admin)/error.tsx` | 1 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/(admin)/events/[id]/edit/page.tsx` | 0 | Preserved domain renderer, section or route wrapper |
| admin | `apps/web/app/(admin)/events/[id]/reservations/page.tsx` | 19 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/(admin)/events/[id]/settlement/export-button.tsx` | 1 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/(admin)/events/[id]/settlement/page.tsx` | 23 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/(admin)/events/event-editor-form.tsx` | 52 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/(admin)/events/events-table.tsx` | 10 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/(admin)/events/loading.tsx` | 0 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/(admin)/events/new/page.tsx` | 0 | Preserved domain renderer, section or route wrapper |
| admin | `apps/web/app/(admin)/events/page.tsx` | 1 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/(admin)/layout.tsx` | 0 | Preserved domain renderer, section or route wrapper |
| admin | `apps/web/app/(admin)/organizations/loading.tsx` | 12 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/(admin)/organizations/manage-admins-dialog.tsx` | 16 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/(admin)/organizations/new-org-dialog.tsx` | 43 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/(admin)/organizations/org-actions.tsx` | 36 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/(admin)/organizations/page.tsx` | 23 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/(admin)/page.tsx` | 0 | Preserved domain renderer, section or route wrapper |
| admin | `apps/web/app/(admin)/payments/event-picker.tsx` | 0 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/(admin)/payments/kpi-section.tsx` | 0 | Preserved domain renderer, section or route wrapper |
| admin | `apps/web/app/(admin)/payments/loading.tsx` | 0 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/(admin)/payments/page.tsx` | 1 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/(admin)/payments/payments-table.tsx` | 0 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/(admin)/payments/reservation-payments-table.tsx` | 33 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/(admin)/payments/reservation-section.tsx` | 0 | Preserved domain renderer, section or route wrapper |
| admin | `apps/web/app/(admin)/payments/table-section.tsx` | 0 | Preserved domain renderer, section or route wrapper |
| admin | `apps/web/app/(admin)/payouts/loading.tsx` | 12 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/(admin)/payouts/page.tsx` | 48 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/(admin)/payouts/reservation-payout-controls.tsx` | 7 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/(admin)/payouts/statement-actions.tsx` | 24 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/(admin)/race-kits/page.tsx` | 4 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/(admin)/race-kits/station.tsx` | 33 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/(admin)/registrations/event-picker.tsx` | 5 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/(admin)/registrations/kpi-section.tsx` | 0 | Preserved domain renderer, section or route wrapper |
| admin | `apps/web/app/(admin)/registrations/loading.tsx` | 0 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/(admin)/registrations/page.tsx` | 7 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/(admin)/registrations/registrations-table.tsx` | 1 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/(admin)/registrations/reservation-section.tsx` | 15 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/(admin)/registrations/table-section.tsx` | 0 | Preserved domain renderer, section or route wrapper |
| admin | `apps/web/app/(admin)/settings/page.tsx` | 2 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/(admin)/settings/settings-form.tsx` | 12 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/(admin)/settings/settings-section.tsx` | 2 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/(admin)/settings/waiver-form.tsx` | 18 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/(admin)/team/loading.tsx` | 0 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/(admin)/team/page.tsx` | 0 | Preserved domain renderer, section or route wrapper |
| admin | `apps/web/app/(admin)/team/team-table.tsx` | 18 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/(admin)/users/page.tsx` | 0 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/(admin)/users/users-directory.tsx` | 60 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/(auth)/forgot-password/page.tsx` | 6 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/(auth)/login/google-button.tsx` | 2 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/(auth)/login/login-form.tsx` | 9 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/(auth)/login/page.tsx` | 1 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/(auth)/no-access/page.tsx` | 4 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/auth/confirm/finish/page.tsx` | 0 | Preserved domain renderer, section or route wrapper |
| admin | `apps/web/app/auth/recovery/page.tsx` | 10 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/app/layout.tsx` | 1 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/components/AddonEditor.tsx` | 0 | Preserved domain renderer, section or route wrapper |
| admin | `apps/web/components/AdminCanvasPreference.tsx` | 1 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/components/AppShell.tsx` | 3 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/components/BottomNav.tsx` | 5 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/components/BulkCancelDialog.tsx` | 9 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/components/CancelModal.tsx` | 10 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/components/CategoryEditor.tsx` | 8 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/components/CommandPalette.tsx` | 10 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/components/CopyButton.tsx` | 1 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/components/CourseDrawEditor.tsx` | 1 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/components/CropUploader.tsx` | 9 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/components/DeliveryFeedback.tsx` | 3 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/components/EventCombobox.tsx` | 6 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/components/EventImagesEditor.tsx` | 1 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/components/FillRatePanel.tsx` | 0 | Preserved domain renderer, section or route wrapper |
| admin | `apps/web/components/InclusionsEditor.tsx` | 0 | Preserved domain renderer, section or route wrapper |
| admin | `apps/web/components/InviteMemberForm.tsx` | 10 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/components/MethodBadge.tsx` | 0 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/components/NavProgress.tsx` | 0 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/components/OrgSwitcher.tsx` | 9 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/components/PhotoAvatar.tsx` | 2 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/components/ProviderBadge.tsx` | 3 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/components/PsgcAddressField.tsx` | 2 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/components/RefundModal.tsx` | 10 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/components/RegistrationDetail.tsx` | 6 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/components/RegistrationHistory.tsx` | 0 | Preserved domain renderer, section or route wrapper |
| admin | `apps/web/components/RescheduleModal.tsx` | 10 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/components/RouteEditor.tsx` | 1 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/components/RunnerAvatar.tsx` | 0 | Preserved domain renderer, section or route wrapper |
| admin | `apps/web/components/ScheduleEditor.tsx` | 0 | Preserved domain renderer, section or route wrapper |
| admin | `apps/web/components/Sidebar.tsx` | 15 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/components/SignupsChart.tsx` | 0 | Preserved domain renderer, section or route wrapper |
| admin | `apps/web/components/StatusBadge.tsx` | 3 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/components/ThemeToggle.tsx` | 1 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/components/TopBar.tsx` | 7 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/components/TurnstileWidget.tsx` | 2 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/components/coming-soon.tsx` | 0 | Preserved domain renderer, section or route wrapper |
| admin | `apps/web/components/data-table/active-filters.tsx` | 2 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/components/data-table/bulk-bar.tsx` | 6 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/components/data-table/column-header.tsx` | 2 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/components/data-table/data-table.tsx` | 10 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/components/data-table/empty-state.tsx` | 1 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/components/data-table/faceted-filter.tsx` | 11 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/components/data-table/pagination.tsx` | 10 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/components/data-table/toolbar.tsx` | 7 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/components/form-section.tsx` | 6 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/components/kpi-card.tsx` | 2 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/components/no-org-scope.tsx` | 1 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/components/org-admins-only.tsx` | 1 | Migrated primitives; dedicated workflow retained |
| admin | `apps/web/components/ui/alert-dialog.tsx` | 2 | Shared reexport or dedicated shared composition |
| admin | `apps/web/components/ui/alert.tsx` | 1 | Shared reexport or dedicated shared composition |
| admin | `apps/web/components/ui/avatar.tsx` | 0 | Shared reexport or dedicated shared composition |
| admin | `apps/web/components/ui/badge.tsx` | 0 | Shared reexport or dedicated shared composition |
| admin | `apps/web/components/ui/breadcrumb.tsx` | 0 | Shared reexport or dedicated shared composition |
| admin | `apps/web/components/ui/button.tsx` | 0 | Shared reexport or dedicated shared composition |
| admin | `apps/web/components/ui/card.tsx` | 0 | Shared reexport or dedicated shared composition |
| admin | `apps/web/components/ui/checkbox.tsx` | 0 | Shared reexport or dedicated shared composition |
| admin | `apps/web/components/ui/command.tsx` | 5 | Shared reexport or dedicated shared composition |
| admin | `apps/web/components/ui/dialog.tsx` | 1 | Shared reexport or dedicated shared composition |
| admin | `apps/web/components/ui/dropdown-menu.tsx` | 0 | Shared reexport or dedicated shared composition |
| admin | `apps/web/components/ui/input.tsx` | 1 | Shared reexport or dedicated shared composition |
| admin | `apps/web/components/ui/label.tsx` | 0 | Shared reexport or dedicated shared composition |
| admin | `apps/web/components/ui/pagination.tsx` | 0 | Shared reexport or dedicated shared composition |
| admin | `apps/web/components/ui/popover.tsx` | 0 | Shared reexport or dedicated shared composition |
| admin | `apps/web/components/ui/searchable-combobox.tsx` | 12 | Shared reexport or dedicated shared composition |
| admin | `apps/web/components/ui/select.tsx` | 0 | Shared reexport or dedicated shared composition |
| admin | `apps/web/components/ui/separator.tsx` | 0 | Shared reexport or dedicated shared composition |
| admin | `apps/web/components/ui/sheet.tsx` | 0 | Shared reexport or dedicated shared composition |
| admin | `apps/web/components/ui/sidebar.tsx` | 15 | Shared reexport or dedicated shared composition |
| admin | `apps/web/components/ui/skeleton.tsx` | 0 | Shared reexport or dedicated shared composition |
| admin | `apps/web/components/ui/sonner.tsx` | 0 | Shared reexport or dedicated shared composition |
| admin | `apps/web/components/ui/table.tsx` | 6 | Shared reexport or dedicated shared composition |
| admin | `apps/web/components/ui/textarea.tsx` | 1 | Shared reexport or dedicated shared composition |
| admin | `apps/web/components/ui/tooltip.tsx` | 0 | Shared reexport or dedicated shared composition |

## Complete catalog mapping

| Component | Final disposition |
|---|---|
| accordion | unused |
| alert | shared-primitive-or-dedicated-composition |
| alert-dialog | shared-primitive-or-dedicated-composition |
| aspect-ratio | unused |
| attachment | unused |
| avatar | shared-primitive-or-dedicated-composition |
| badge | shared-primitive-or-dedicated-composition |
| breadcrumb | shared-primitive-or-dedicated-composition |
| bubble | unused |
| button | shared-primitive-or-dedicated-composition |
| button-group | unused |
| calendar | unused |
| card | shared-primitive-or-dedicated-composition |
| carousel | unused |
| chart | shared-primitive-or-dedicated-composition |
| checkbox | shared-primitive-or-dedicated-composition |
| collapsible | shared-primitive-or-dedicated-composition |
| combobox | shared-primitive-or-dedicated-composition |
| command | shared-primitive-or-dedicated-composition |
| context-menu | unused |
| data-table | shared-primitive-or-dedicated-composition |
| date-picker | unused |
| dialog | shared-primitive-or-dedicated-composition |
| direction | unused |
| drawer | unused |
| dropdown-menu | shared-primitive-or-dedicated-composition |
| empty | shared-primitive-or-dedicated-composition |
| field | shared-primitive-or-dedicated-composition |
| form | unused |
| hover-card | unused |
| input | shared-primitive-or-dedicated-composition |
| input-group | shared-primitive-or-dedicated-composition |
| input-otp | unused |
| item | shared-primitive-or-dedicated-composition |
| kbd | unused |
| label | shared-primitive-or-dedicated-composition |
| marker | unused |
| menubar | unused |
| message | unused |
| message-scroller | unused |
| native-select | shared-primitive-or-dedicated-composition |
| navigation-menu | unused |
| pagination | shared-primitive-or-dedicated-composition |
| popover | shared-primitive-or-dedicated-composition |
| progress | shared-primitive-or-dedicated-composition |
| radio-group | shared-primitive-or-dedicated-composition |
| resizable | unused |
| scroll-area | unused |
| select | shared-primitive-or-dedicated-composition |
| separator | shared-primitive-or-dedicated-composition |
| sheet | shared-primitive-or-dedicated-composition |
| sidebar | shared-primitive-or-dedicated-composition |
| skeleton | shared-primitive-or-dedicated-composition |
| slider | shared-primitive-or-dedicated-composition |
| sonner | shared-primitive-or-dedicated-composition |
| spinner | shared-primitive-or-dedicated-composition |
| switch | shared-primitive-or-dedicated-composition |
| table | shared-primitive-or-dedicated-composition |
| tabs | shared-primitive-or-dedicated-composition |
| textarea | shared-primitive-or-dedicated-composition |
| toggle | unused |
| toggle-group | shared-primitive-or-dedicated-composition |
| tooltip | shared-primitive-or-dedicated-composition |

## Reconciled findings

- [x] Shared source snapshot, component tokens, application reexports and Tailwind registration.
- [x] Shirt sheet and course editor use bounded modal content with dismissal and focus restoration.
- [x] Race tabs, commission/payment/shirt radio choices and combobox active options expose keyboard state.
- [x] Form labels, required state, hints and errors use shared fields while preserving native payloads.
- [x] File pickers use focusable triggers; crop dialogs fit phone viewports.
- [x] Tables, menus, alerts, statuses, loading and empty states use shared primitives.
- [x] Navigation links retain URLs and active state; disabled/loading controls retain locks.
- [x] Maps, charts, QR tickets, financial values and specialized workflows remain dedicated.
- [x] Application types, suites, isolated builds, responsive/keyboard/dark/reduced-motion/print checks recorded.
- [x] Unused catalog patterns remain unused; no new behavior added to demonstrate a component.

Native file and hidden inputs are intentional exceptions. Native dates/times use Input; independent disclosures use Collapsible. Combobox and DataTable remain dedicated compositions of Command/Popover and Table. Chart uses component tokens with the existing SVG renderer. The existing gallery retains its controller with Dialog and Button.
