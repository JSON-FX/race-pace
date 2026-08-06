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

  /** null removes the key. Every caller that changes what is being listed
   *  passes page: null too, so you never land on page 9 of a 2-page result. */
  const patch = useCallback(
    (next: Record<string, string | null>) => {
      const sp = new URLSearchParams(searchParams.toString());
      for (const [k, v] of Object.entries(next)) {
        if (v === null || v === "" || v === "all") sp.delete(k);
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
    setFilter: (key: string, value: string) => patch({ [key]: value, page: null }),
    setQ: (value: string) => patch({ q: value || null, page: null }),
    clearFilters: () => {
      const sp = new URLSearchParams(searchParams.toString());
      for (const key of Array.from(sp.keys())) {
        if (key !== "sort" && key !== "per") sp.delete(key);
      }
      const qs = sp.toString();
      startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
    },
  };
}
