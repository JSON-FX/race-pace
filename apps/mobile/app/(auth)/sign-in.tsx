import { useState } from "react";
import { View, TextInput, KeyboardAvoidingView, Platform, Image, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useVideoPlayer, VideoView } from "expo-video";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { useAuth } from "../../lib/auth";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { GoogleLogo, FacebookLogo } from "@/components/SocialLogos";

const BG_VIDEO = require("../../assets/racepace-login-bg.mp4");
const LOGO = require("../../assets/login-logo.png");

// Shared field styling: translucent-white bg + white text + light placeholder,
// mirroring the previous inline style (rgba(255,255,255,0.12) bg /
// rgba(255,255,255,0.28) border / #fff text / rgba(255,255,255,0.7) placeholder).
const FIELD_CLASS =
  "rounded-[11px] border border-white/25 bg-white/10 p-[15px] text-[17px] text-white placeholder:text-white/70";

export default function SignIn() {
  const { signIn } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const player = useVideoPlayer(BG_VIDEO, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  async function onSubmit() {
    setBusy(true); setError(null);
    const { error } = await signIn(email.trim(), password);
    setBusy(false);
    if (error) setError(error);
    else router.replace("/");
  }

  // OAuth providers aren't wired up yet — the buttons are real, the flow is next.
  function onOAuth(provider: "Google" | "Facebook") {
    Alert.alert(`Sign in with ${provider}`, "Social sign-in is coming soon.");
  }

  return (
    // This screen always sits on the dark login video, in BOTH app themes —
    // so nothing below uses theme-flipping tokens (bg-background/
    // text-foreground would swap to light-mode colors and vanish against the
    // video). Every color here is a fixed, theme-independent value.
    <View className="flex-1 bg-forest">
      <StatusBar style="light" />
      <VideoView
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        player={player}
        contentFit="cover"
        nativeControls={false}
      />
      {/* Forest-black wash (fixed, not a theme color) so the wordmark + form read clearly over raw footage. */}
      <View className="absolute inset-0 bg-[#0A1A13] opacity-55" pointerEvents="none" />
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View
          className="flex-1 justify-end px-7"
          style={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 28 }}
        >
          <View className="flex-1 items-center justify-center">
            <Image
              source={LOGO}
              style={{ width: "64%", aspectRatio: 1.5487, maxHeight: 124 }}
              resizeMode="contain"
              accessibilityLabel="Race Pace"
            />
          </View>
          <View className="gap-3">
            <TextInput
              className={FIELD_CLASS}
              placeholder="Email"
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
              accessibilityLabel="Email"
            />
            <TextInput
              className={FIELD_CLASS}
              placeholder="Password"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              accessibilityLabel="Password"
            />
            {error ? <Text className="text-[#FF6B61] text-sm">{error}</Text> : null}
            <Button onPress={onSubmit} disabled={busy} className="mt-1 h-auto py-4 sm:h-auto">
              <Text className="text-[17px] font-semibold text-white">{busy ? "Signing in…" : "Sign in"}</Text>
            </Button>

            {/* Divider between email sign-in and the social options */}
            <View className="mt-1 flex-row items-center gap-3">
              <View className="h-px flex-1 bg-white/20" />
              <Text className="text-[13px] text-white/50">or</Text>
              <View className="h-px flex-1 bg-white/20" />
            </View>

            {/* Google — white button, 4-color mark, dark label (Google brand button) */}
            <Button
              onPress={() => onOAuth("Google")}
              className="h-auto gap-2.5 bg-white py-4 shadow-sm active:bg-white/90 sm:h-auto"
              accessibilityLabel="Sign in with Google"
            >
              <GoogleLogo size={19} />
              <Text className="text-[16px] font-semibold text-[#1F1F1F]">Sign in with Google</Text>
            </Button>

            {/* Facebook — brand-blue button, white "f", white label */}
            <Button
              onPress={() => onOAuth("Facebook")}
              className="h-auto gap-2.5 bg-[#1877F2] py-4 shadow-sm active:bg-[#1877F2]/90 sm:h-auto"
              accessibilityLabel="Sign in with Facebook"
            >
              <FacebookLogo size={18} />
              <Text className="text-[16px] font-semibold text-white">Sign in with Facebook</Text>
            </Button>

            {/* Create account — outlined tertiary CTA (transparent over the video) */}
            <Button
              onPress={() => router.push("/(auth)/sign-up")}
              className="mt-1 h-auto border border-white/30 bg-transparent py-4 shadow-none active:bg-white/10 sm:h-auto"
              accessibilityLabel="Create an account"
            >
              <Text className="text-[16px] font-semibold text-white">Create an account</Text>
            </Button>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
