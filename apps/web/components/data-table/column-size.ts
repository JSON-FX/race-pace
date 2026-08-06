import type { ColumnDef } from "@tanstack/react-table";

/** tanstack/react-table hard-codes 150 as `defaultColumn.size`
 *  (@tanstack/table-core's `index.esm.js`, `size: 150`) and merges it into
 *  EVERY column's resolved `columnDef` — including ones that never declared
 *  a `size` at all. That means `columnDef.size !== undefined` is not a
 *  reliable "did the caller actually declare a width" check; it's true for
 *  every column, always. This codebase doesn't override tanstack's
 *  `defaultColumn` table option, so 150 is unambiguously "nobody asked for
 *  a width" here — anything else (e.g. the `__select` column's declared
 *  `size: 38`) is a real, intentional width. */
const TANSTACK_DEFAULT_COLUMN_SIZE = 150;

export function declaredColumnWidth(size: ColumnDef<unknown, unknown>["size"]): number | undefined {
  return size !== undefined && size !== TANSTACK_DEFAULT_COLUMN_SIZE ? size : undefined;
}
