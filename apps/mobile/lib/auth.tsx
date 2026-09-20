import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { clearTicketCache } from "./ticketCache";
import { getAuthCaptchaToken } from "./captcha";

type AuthValue = {
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signUp: (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const signIn: AuthValue["signIn"] = async (email, password) => {
    try {
      const captchaToken = await getAuthCaptchaToken();
      const { error } = await supabase.auth.signInWithPassword({ email, password, options: { captchaToken } });
      return error ? { error: error.message } : {};
    } catch {
      return { error: "Bot verification did not complete. Please try again." };
    }
  };
  const signUp: AuthValue["signUp"] = async (email, password) => {
    try {
      const captchaToken = await getAuthCaptchaToken();
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { captchaToken },
      });
      return error ? { error: error.message } : {};
    } catch {
      return { error: "Bot verification did not complete. Please try again." };
    }
  };
  const signOut = async () => {
    try { await clearTicketCache(); } catch { /* cache-clear failure must not block sign-out */ }
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ session, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
