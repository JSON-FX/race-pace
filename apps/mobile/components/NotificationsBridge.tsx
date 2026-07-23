import { useEffect } from "react";
import { useRouter } from "expo-router";
import * as Notifications from "expo-notifications";
import { useAuth } from "../lib/auth";
import { useNotificationsRealtime } from "../lib/notifications";
import { registerForPush } from "../lib/push";
import { routeFor } from "../lib/notificationMeta";

// Headless: wires the live inbox, registers the device token, and routes notification taps.
// Mounted once inside AuthProvider (app/_layout.tsx).
export default function NotificationsBridge() {
  const { session } = useAuth();
  const userId = session?.user?.id;
  const router = useRouter();

  useNotificationsRealtime(userId);

  useEffect(() => {
    if (userId) registerForPush(userId).catch(() => {});
  }, [userId]);

  useEffect(() => {
    const go = (data: { type?: string; event_id?: string; registration_id?: string } | undefined) => {
      const route = routeFor(data?.type ?? "", data ?? {});
      if (route) router.push(route as never);
    };
    Notifications.getLastNotificationResponseAsync().then((r) => {
      if (r) go(r.notification.request.content.data as never);
    });
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      go(r.notification.request.content.data as never);
    });
    return () => sub.remove();
  }, [router]);

  return null;
}
