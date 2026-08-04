export function Placeholder({ title }: { title: string }) {
  return (
    <div className="px-[30px] pt-[26px] pb-10">
      <div className="rounded-xl border border-border bg-card px-6 py-10 text-center">
        <div className="text-base font-semibold">{title}</div>
        <div className="mt-1.5 text-sm text-muted-foreground">Coming soon.</div>
      </div>
    </div>
  );
}
