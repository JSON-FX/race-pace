"use client";

import { useCallback, useMemo, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DEFAULT_PER, type SortState } from "./table-params";

/** Writes table state into the URL. Parsing happens server-side in
 *  table-params.ts — this hook never reads state back for rendering.
 *
 *  Every setter below (and `clearFilters`) is wrapped in `useCallback`, and
 *  the whole return value in `useMemo`, so the returned object — and every
 *  function on it — is referentially stable across renders as long as
 *  `patch`'s own deps (`pathname`, `router`, `searchParams`) don't change.
 *  This matters beyond mere perf: a caller that memoises a `useMemo`'d
 *  column list depending on e.g. `setFilter` (any page whose cells need a
 *  setter — see Registrations' Runner cell) needs that dependency to
 *  actually be stable, or the memo either recomputes every render (defeats
 *  the point) or — worse, if the dependency is dropped to "fix" that —
 *  freezes on a stale closure that silently keeps operating on an old
 *  `searchParams` snapshot after the URL has moved on. */
export function useTableParams() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  /** null (or "") removes the key, anything else sets it verbatim. This is a
   *  generic URL writer — it must NOT special-case the string "all", or a
   *  literal search for the word "all" gets silently dropped (setQ routes
   *  through here too). The "all" sentinel is a filter-domain concept and is
   *  handled in setFilter, where it belongs. */
  const patch = useCallback(
    (next: Record<string, string | null>) => {
      const sp = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(next)) {
        if (v === null || v === "") sp.delete(k);
        else sp.set(k, v);
      }
      const qs = sp.toString();
      startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
    },
    [pathname, router, searchParams],
  );

  const setPage = useCallback(
    (p: number) => patch({ page: p <= 1 ? null : String(p) }),
    [patch],
  );

  const setPer = useCallback(
    (n: number) => patch({ per: n === DEFAULT_PER ? null : String(n), page: null }),
    [patch],
  );

  const setSort = useCallback(
    (s: SortState[]) =>
      patch({ sort: s.length ? s.map((x) => `${x.id}:${x.desc ? "desc" : "asc"}`).join(",") : null, page: null }),
    [patch],
  );

  /** "all" is FacetedFilter's own sentinel for "no filter" — translate it
   *  to a key removal here, not in `patch`. */
  const setFilter = useCallback(
    (key: string, value: string) => patch({ [key]: value === "all" ? null : value, page: null }),
    [patch],
  );

  const setQ = useCallback(
    (value: string) => patch({ q: value || null, page: null }),
    [patch],
  );

  /** Drops every query param except `sort`, `per`, and whatever's in
   *  `keep` — pass the page's own structural params (e.g. Registrations
   *  passes `["event"]`) so "Clear all" can't navigate the admin off the
   *  page they're scoped to.
   *
   *  Reads `searchParams` directly (not via `patch`) because it needs the
   *  live query string to decide what to *delete*, not just what to set —
   *  same deps as `patch` for exactly that reason: a stale `searchParams`
   *  closure here would clear the wrong set of params after a navigation,
   *  the same class of bug `patch` itself is careful to avoid. */
  const clearFilters = useCallback(
    (keep: string[] = []) => {
      const preserve = new Set(["sort", "per", ...keep]);
      const sp = new URLSearchParams(searchParams.toString());
      for (const key of Array.from(sp.keys())) {
        if (!preserve.has(key)) sp.delete(key);
      }
      const qs = sp.toString();
      startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
    },
    [pathname, router, searchParams],
  );

  return useMemo(
    () => ({ isPending, patch, setPage, setPer, setSort, setFilter, setQ, clearFilters }),
    [isPending, patch, setPage, setPer, setSort, setFilter, setQ, clearFilters],
  );
}
