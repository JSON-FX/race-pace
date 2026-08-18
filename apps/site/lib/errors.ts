const MESSAGES: Record<string, string> = {
  sold_out: "This distance just sold out. Try another distance for this race.",
  registration_closed: "Registration for this race is no longer open.",
  not_pending: "You've already paid for this registration. Check My Races for your ticket.",
  waiver_required: "Please accept the event waiver before registering.",
  invalid_custom_data: "Some answers need fixing. Check the highlighted fields.",
  invalid_input: "Some details are missing or invalid. Check the form and try again.",
  unauthorized: "Your session expired. Please sign in again.",
  category_not_found: "This distance is no longer available.",
  registration_not_found: "We couldn't find that registration.",
  registration_failed: "We couldn't save your registration. Please try again.",
  server_error: "Something went wrong on our end. Please try again.",
  // registrations-checkout:58 and payment-session both answer 409
  // { error: "org_suspended" } when the platform has switched an organizer
  // off. Deliberately carries NO "try again" — the condition is permanent
  // until a super admin un-suspends the org, and the generic fallback this
  // used to reach ("Something went wrong. Please try again.") invited a
  // retry loop against it. "Nothing was charged" is the other half: a runner
  // told only that something failed on the pay screen has no way to know
  // whether their money moved.
  org_suspended:
    "This organizer isn't taking registrations right now. Nothing was charged — try again another time or pick another race.",
  // Fallback copy only — startCheckout's CheckoutError carries a
  // registration_id whenever the 409 body has one, and RegisterWizard routes
  // straight to /pay/<id> in that case rather than showing this string. This
  // is what's left for the rare case where the body didn't carry an id.
  // Mirrors apps/mobile/app/register/[categoryId].tsx's fallback copy for the
  // same gap.
  already_registered: "You're already entered in this race. Check My Races for your entry.",
};

export function checkoutErrorMessage(code: string): string {
  return MESSAGES[code] ?? "Something went wrong. Please try again.";
}
