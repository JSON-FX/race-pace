import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

/** One of these per row, deterministically keyed off the row id so the same
 *  runner always gets the same tint (and re-renders/re-sorts don't make
 *  avatars flicker between colors) — matches the mockup's varied avatar
 *  tints (`.ava` with an inline background override on some rows) without
 *  needing a real "brand color" concept per runner. */
const TINTS = [
  { bg: "bg-paid-tint", fg: "text-forest dark:text-paid" },
  { bg: "bg-info-tint", fg: "text-info" },
  { bg: "bg-amber-tint", fg: "text-amber" },
  { bg: "bg-destructive-tint", fg: "text-destructive" },
];

/** Exported so the detail modal's larger avatar lands on the SAME tint as the
 *  row the admin clicked — a runner changing colour between the table and their
 *  own detail view reads as a different person. */
export function avatarTint(key: string) {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return TINTS[hash % TINTS.length];
}

/** The mockup's `.who` cell: a 30px initials avatar beside name-over-email.
 *  `name`/`email` render "—" when absent rather than an empty cell — an
 *  admin scanning the column shouldn't see a blank and wonder if the data
 *  failed to load. */
export function RunnerAvatar({ id, name, email, className }: {
  id: string; name: string | null; email: string | null; className?: string;
}) {
  const tint = avatarTint(id);
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <Avatar className="size-[30px]">
        <AvatarFallback className={cn("text-[11.5px] font-bold", tint.bg, tint.fg)}>
          {initials(name)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <div className="truncate text-[13px] font-semibold">{name ?? "—"}</div>
        <div className="truncate text-[11.5px] text-muted-foreground">{email ?? "—"}</div>
      </div>
    </div>
  );
}
