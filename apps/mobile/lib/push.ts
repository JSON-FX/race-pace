import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { Platform } from "react-native";
import { supabase } from "./supabase";

// Show a banner + bump the badge when a push arrives in the foreground.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true,
  }),
});

// Registers this device's Expo push token. No-op on simulators (no APNs token) and when
// the user denies permission — the in-app inbox still works everywhere. Design §6/§9.
export async function registerForPush(userId: string): Promise<string | null> {
  // Push is gated behind EXPO_PUBLIC_ENABLE_PUSH (see app.config.js). Off by default so
  // local/dev device builds sign on a free Apple team; the in-app inbox works regardless.
  if (process.env.EXPO_PUBLIC_ENABLE_PUSH !== "1") return null;
  if (!Device.isDevice) return null;
  const existing = await Notifications.getPermissionsAsync();
  const status = existing.status === "granted"
    ? existing.status
    : (await Notifications.requestPermissionsAsync()).status;
  if (status !== "granted") return null;

  const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
  const { data: token } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  await supabase.from("device_tokens").upsert(
    { user_id: userId, token, platform: Platform.OS }, { onConflict: "token" });
  return token;
}
