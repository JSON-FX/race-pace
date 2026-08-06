/**
 * The "no event filter" sentinel, shared by the page (a Server Component) and
 * the picker (a Client Component).
 *
 * In its own plain module deliberately. It used to live in `event-picker.tsx`,
 * which carries "use client" — and importing a plain constant from a client
 * module into a Server Component does NOT give you the value. Next replaces the
 * module with a client reference, so `ALL_EVENTS` arrived as `undefined` and
 * every `activeEvent !== ALL_EVENTS` check took the wrong branch: an unfiltered
 * page rendered "2 transactions in this event" beside a picker reading "All
 * events". It fails silently, with no type error and no runtime warning.
 *
 * A module with no "use client" directive is importable from both sides, which
 * is what a shared constant needs.
 */
export const ALL_EVENTS = "all";
