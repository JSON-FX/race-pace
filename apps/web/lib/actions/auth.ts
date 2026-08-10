"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getMyRoles } from "@/lib/queries/roles";
import { safeNextPath, homePathFor } from "@/lib/routes";

export type AuthState = { error?: string };

export async function signInAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  // Absent, not defaulted to "/events" — see login-form.tsx's comment. A
  // hidden field the form omits comes back as `null` from formData.get, so
  // this stays a real "no destination" state through to the fallback below.
  const nextRaw = formData.get("next");
  const next = typeof nextRaw === "string" && nextRaw.length > 0 ? nextRaw : null;

  if (!email || !password) return { error: "Enter your email and password." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // Two very different failures used to render the same sentence.
    //
    // A genuine credential miss must stay vague: Supabase returns the same
    // `invalid_credentials` for a wrong password and an unknown address, and
    // disambiguating would hand an unauthenticated caller a user-enumeration
    // oracle. That behaviour is preserved exactly.
    //
    // A CONFIGURATION failure — wrong project, bad anon key, auth unreachable —
    // is not the operator's fault and telling them "that email and password
    // don't match" actively sends them hunting for the wrong thing. It cost real
    // time on this project: three admin accounts had been deleted from the
    // hosted database, and the login screen reported it as bad credentials, so
    // it read as a broken deployment.
    //
    // The distinction is made SERVER-side. The browser still learns nothing it
    // could enumerate with; the detail goes to the server log, where an operator
    // debugging a deploy will actually look.
    const isCredentialMiss =
      error.code === "invalid_credentials" ||
      error.status === 400 ||
      /invalid login credentials/i.test(error.message);

    if (!isCredentialMiss) {
      console.error("[signIn] auth is not reachable or is misconfigured", {
        status: error.status,
        code: error.code,
        message: error.message,
      });
      return {
        error: "Sign-in is temporarily unavailable. This is a server problem, not your password.",
      };
    }

    return { error: "That email and password don't match an account." };
  }

  revalidatePath("/", "layout");
  // The session now exists, so getMyRoles() can resolve capabilities — it
  // could not before signInWithPassword above succeeded. This mirrors
  // auth/callback/route.ts exactly: both entry points into the console
  // resolve "no explicit destination" through the same homePathFor, so a
  // check_in-only (marshal) account signing in with a password from a bare
  // /login lands on /check-in here too, not on a manage_org page it can't
  // reach. Only the fallback is capability-aware; an explicit `next` is
  // still honoured as-is and the destination page's own guard still applies.
  const roles = await getMyRoles();
  const fallback = homePathFor(roles?.capabilities ?? []);
  // redirect() throws internally; it must be outside any try/catch.
  redirect(safeNextPath(next, fallback));
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
