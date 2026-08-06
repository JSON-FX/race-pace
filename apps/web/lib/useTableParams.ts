import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

export type SortState = { id: string; desc: boolean };

export type TableParams = {
  page: number;
  sort: SortState[];
  filters: Record<string, string>;
  q: string;
};

const RESERVED = new Set(["page", "sort", "q"]);

function parseSort(raw: string | null, fallback: SortState[]): SortState[] {
  if (!raw) return fallback;
  return raw.split(",").filter(Boolean).map((part) => {
    const [id, dir] = part.split(":");
    return { id: id ?? "", desc: dir === "desc" };
  });
}

const formatSort = (s: SortState[]) => s.map((x) => `${x.id}:${x.desc ? "desc" : "asc"}`).join(",");

export function useTableParams(defaults?: { sort?: SortState[]; filters?: Record<string, string> }) {
  const [params, setParams] = useSearchParams();
  const defaultSort = defaults?.sort ?? [];
  const defaultFilters = defaults?.filters ?? {};

  const page = Math.max(1, Number(params.get("page") ?? 1) || 1);
  const q = params.get("q") ?? "";
  const sort = useMemo(() => parseSort(params.get("sort"), defaultSort), [params, defaultSort]);

  const filters = useMemo(() => {
    const out: Record<string, string> = { ...defaultFilters };
    params.forEach((value, key) => { if (!RESERVED.has(key)) out[key] = value; });
    return out;
  }, [params, defaultFilters]);

  const patch = useCallback((next: Record<string, string | null>) => {
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(next)) {
        if (v === null || v === "") p.delete(k);
        else p.set(k, v);
      }
      return p;
    }, { replace: true });
  }, [setParams]);

  return {
    page,
    sort,
    filters,
    q,
    setPage: (p: number) => patch({ page: p <= 1 ? null : String(p) }),
    setSort: (s: SortState[]) => patch({ sort: s.length ? formatSort(s) : null, page: null }),
    setFilter: (key: string, value: string) => patch({ [key]: value === "all" ? null : value, page: null }),
    setQ: (value: string) => patch({ q: value || null, page: null }),
  };
}
