import { useState } from "react";
import { View } from "react-native";
import { Link, useRouter } from "expo-router";
import { useAuth } from "../../lib/auth";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";

export default function SignUp() {
  const { signUp } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit() {
    setBusy(true); setError(null);
    const { error } = await signUp(email.trim(), password);
    setBusy(false);
    if (error) setError(error);
    else router.replace("/");
  }

  return (
    <View className="flex-1 justify-center gap-3 bg-background p-6">
      <Text className="mb-2 text-3xl font-semibold tracking-[-0.5px] text-foreground">Create account</Text>
      <Input placeholder="Email" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} accessibilityLabel="Email" />
      <Input placeholder="Password (min 6)" secureTextEntry value={password} onChangeText={setPassword} accessibilityLabel="Password" />
      {error ? <Text className="text-destructive">{error}</Text> : null}
      <Button onPress={onSubmit} disabled={busy} className="mt-1 h-auto py-4 sm:h-auto">
        <Text className="text-[17px] font-semibold text-primary-foreground">{busy ? "Creating…" : "Create account"}</Text>
      </Button>
      <Link href="/(auth)/sign-in" className="mt-2 text-center text-primary">I already have an account</Link>
    </View>
  );
}
