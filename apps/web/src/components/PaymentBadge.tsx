const PAY: Record<string, { label: string; color: string; bg: string }> = {
  paid: { label: "Paid", color: "var(--forest)", bg: "var(--parchment)" },
  pending: { label: "Pending", color: "var(--amber)", bg: "var(--amber-tint)" },
  refunded: { label: "Refunded", color: "var(--info)", bg: "var(--info-tint)" },
  failed: { label: "Failed", color: "var(--danger)", bg: "var(--danger-tint)" },
};

export function PaymentBadge({ status }: { status: string | null }) {
  const s = PAY[status ?? ""] ?? { label: status ?? "—", color: "var(--ink-muted)", bg: "var(--parchment)" };
  return <span style={{ display: "inline-block", fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: "var(--radius-pill)", color: s.color, background: s.bg }}>{s.label}</span>;
}
