"use client";

import { useCallback, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DEFAULT_PER, type SortState } from "./table-params";

/** Writes table state into the URL. Parsing happens server-side in
 *  table-params.ts — this hook never reads state back for rendering. */
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

  return {
    isPending,
    patch,
    setPage: (p: number) => patch({ page: p <= 1 ? null : String(p) }),
    setPer: (n: number) => patch({ per: n === DEFAULT_PER ? null : String(n), page: null }),
    setSort: (s: SortState[]) =>
      patch({ sort: s.length ? s.map((x) => `${x.id}:${x.desc ? "desc" : "asc"}`).join(",") : null, page: null }),
    /** "all" is FacetedFilter's own sentinel for "no filter" — translate it
     *  to a key removal here, not in `patch`. */
    setFilter: (key: string, value: string) => patch({ [key]: value === "all" ? null : value, page: null }),
    setQ: (value: string) => patch({ q: value || null, page: null }),
    /** Drops every query param except `sort`, `per`, and whatever's in
     *  `keep` — pass the page's own structural params (e.g. Registrations
     *  passes `["event"]`) so "Clear all" can't navigate the admin off the
     *  page they're scoped to. */
    clearFilters: (keep: string[] = []) => {
      const preserve = new Set(["sort", "per", ...keep]);
      const sp = new URLSearchParams(searchParams.toString());
      for (const key of Array.from(sp.keys())) {
        if (!preserve.has(key)) sp.delete(key);
      }
      const qs = sp.toString();
      startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
    },
  };
}
