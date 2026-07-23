import { useEffect } from "react";
import { supabase } from "./supabase";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export type NotificationRow = {
  id: string; type: string; title: string; body: string;
  data: { event_id?: string; registration_id?: string } | null;
  read_at: string | null; created_at: string;
};

const KEY = ["notifications"] as const;
const UNREAD = ["notifications-unread"] as const;

export async function fetchNotifications(): Promise<NotificationRow[]> {
  const { data, error } = await supabase
    .from("notifications").select("id,type,title,body,data,read_at,created_at")
    .order("created_at", { ascending: false }).limit(100);
  if (error) throw error;
  return (data ?? []) as NotificationRow[];
}
export function useNotifications() {
  return useQuery({ queryKey: KEY, queryFn: fetchNotifications });
}

export async function fetchUnreadCount(): Promise<number> {
  const { count, error } = await supabase
    .from("notifications").select("id", { count: "exact", head: true }).is("read_at", null);
  if (error) throw error;
  return count ?? 0;
}
export function useUnreadCount() {
  return useQuery({ queryKey: UNREAD, queryFn: fetchUnreadCount });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => { qc.invalidateQueries({ queryKey: KEY }); qc.invalidateQueries({ queryKey: UNREAD }); };
}

export function useMarkRead() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}
export function useMarkUnread() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("notifications").update({ read_at: null }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}
export function useMarkAllRead() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async () => {
      // RLS restricts to the caller's own rows, so no user filter is needed.
      const { error } = await supabase.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
}

export function useNotificationsRealtime(userId: string | undefined) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        () => { qc.invalidateQueries({ queryKey: KEY }); qc.invalidateQueries({ queryKey: UNREAD }); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [userId, qc]);
}
