export type SortState = { id: string; desc: boolean };

export type TableParams = {
  page: number;
  per: number;
  sort: SortState[];
  filters: Record<string, string>;
  q: string;
};

export type TableDefaults = { sort?: SortState[]; filters?: Record<string, string> };

export const PER_PAGE_OPTIONS = [10, 25, 50, 100] as const;
export const DEFAULT_PER = 25;

/** `page`, `per`, `sort` and `q` are structural; every other key is a filter. */
const RESERVED = new Set(["page", "per", "sort", "q"]);

/** Next gives repeated params as arrays. Admin URLs never mean "both", so
 *  take the first and ignore the rest rather than 400-ing on a stray dup. */
function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function parseSort(raw: string | undefined, fallback: SortState[]): SortState[] {
  if (!raw) return fallback;
  const parsed = raw
    .split(",")
    .filter(Boolean)
    .map((part) => {
      const [id, dir] = part.split(":");
      return { id: id ?? "", desc: dir === "desc" };
    })
    .filter((s) => s.id !== "");
  return parsed.length ? parsed : fallback;
}

const formatSort = (s: SortState[]) => s.map((x) => `${x.id}:${x.desc ? "desc" : "asc"}`).join(",");

export function parseTableParams(
  sp: Record<string, string | string[] | undefined>,
  defaults: TableDefaults = {},
): TableParams {
  const rawPage = Number(one(sp.page) ?? 1);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;

  const rawPer = Number(one(sp.per) ?? DEFAULT_PER);
  const per = (PER_PAGE_OPTIONS as readonly number[]).includes(rawPer) ? rawPer : DEFAULT_PER;

  const filters: Record<string, string> = { ...(defaults.filters ?? {}) };
  for (const [key, value] of Object.entries(sp)) {
    if (RESERVED.has(key)) continue;
    const v = one(value);
    if (v !== undefined) filters[key] = v;
  }

  return {
    page,
    per,
    sort: parseSort(one(sp.sort), defaults.sort ?? []),
    filters,
    q: one(sp.q) ?? "",
  };
}

/** Inverse of parseTableParams. Values equal to their default are omitted so
 *  the canonical URL for an unfiltered first page is the bare pathname. */
export function serializeTableParams(p: Partial<TableParams>, defaults: TableDefaults = {}): URLSearchParams {
  const out = new URLSearchParams();
  if (p.page && p.page > 1) out.set("page", String(p.page));
  if (p.per && p.per !== DEFAULT_PER) out.set("per", String(p.per));
  if (p.q) out.set("q", p.q);
  if (p.sort?.length) out.set("sort", formatSort(p.sort));
  for (const [key, value] of Object.entries(p.filters ?? {})) {
    const dflt = defaults.filters?.[key] ?? "all";
    if (value && value !== dflt) out.set(key, value);
  }
  return out;
}

/** "51–75 of 791". En dash, not a hyphen — it is a numeric range. */
export function rangeLabel(page: number, per: number, total: number): string {
  if (total === 0) return "0 of 0";
  const first = (page - 1) * per + 1;
  const last = Math.min(page * per, total);
  return `${first}–${last} of ${total}`;
}
