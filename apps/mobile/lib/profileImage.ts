import * as ImagePicker from "expo-image-picker";
import { supabase } from "./supabase";

const BUCKET = "profile-images";

// Let the runner pick a photo, upload it under their own folder in the
// profile-images bucket ({uid}/{kind}-{ts}.{ext} — the first path segment is
// what the owner-scoped RLS checks), and return its public URL.
// Returns null if the picker was dismissed.
export async function pickAndUploadProfileImage(
  userId: string,
  kind: "avatar" | "cover",
): Promise<string | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new Error("Photo access is off. Enable it for Race Pace in Settings to choose a photo.");

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsEditing: true,
    aspect: kind === "avatar" ? [1, 1] : [16, 9],
    quality: 0.7,
  });
  if (result.canceled || !result.assets?.length) return null;

  const asset = result.assets[0];
  const ext = (asset.mimeType?.split("/")[1] || asset.uri.split(".").pop() || "jpg").toLowerCase();
  const contentType = asset.mimeType || `image/${ext === "jpg" ? "jpeg" : ext}`;
  const arrayBuffer = await fetch(asset.uri).then((r) => r.arrayBuffer());

  const path = `${userId}/${kind}-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, arrayBuffer, { contentType, upsert: true });
  if (error) throw new Error(error.message);

  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}
