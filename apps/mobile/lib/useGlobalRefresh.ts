import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

/** One shared pull-to-refresh implementation for every data screen: refetches
 *  whatever queries are currently mounted, so new screens adopt it with no
 *  per-screen query-key wiring. */
export function useGlobalRefresh() {
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await qc.refetchQueries({ type: "active" });
    } finally {
      setRefreshing(false);
    }
  }, [qc]);
  return { refreshing, onRefresh };
}
