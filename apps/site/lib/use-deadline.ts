"use client";

import { useEffect, useState } from "react";

/** Re-render at the cutoff even if a provider reconciliation keeps the row pending. */
export function useDeadline(deadline: string | null | undefined): void {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const remaining = deadline ? Date.parse(deadline) - Date.now() : 0;
    if (!Number.isFinite(remaining) || remaining <= 0) return;
    const timer = setTimeout(() => setRevision(value => value + 1), Math.min(remaining + 1, 2_147_483_647));
    return () => clearTimeout(timer);
  }, [deadline, revision]);
}
