import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import logo from "../assets/login-logo.png";

export function Login() {
  const { signIn, session } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (session) nav("/", { replace: true }); }, [session, nav]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error } = await signIn(email.trim(), password);
    setBusy(false);
    if (error) setError(error); else nav("/", { replace: true });
  }

  return (
    <div className="grid min-h-full place-items-center bg-muted p-6">
      <Card className="w-full max-w-[400px] rounded-[22px] border-border p-9 shadow-sm">
        <form onSubmit={onSubmit}>
          <img src={logo} alt="Race Pace" className="mx-auto block h-16 w-auto" />
          <div className="mt-2 text-center text-[13px] text-muted-foreground">Event admin console</div>

          <h1 className="mt-7 text-[22px] font-bold tracking-[-.3px] text-foreground">Sign in</h1>

          <div className="mt-4 flex flex-col gap-3.5">
            <div>
              <Label htmlFor="login-email" className="mb-1.5 text-[11px] font-semibold tracking-[.4px] text-muted-foreground uppercase">
                Email
              </Label>
              <Input
                id="login-email"
                aria-label="Email"
                type="email"
                autoCapitalize="none"
                placeholder="alma@aposkyrunners.ph"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="login-password" className="mb-1.5 text-[11px] font-semibold tracking-[.4px] text-muted-foreground uppercase">
                Password
              </Label>
              <div className="flex h-9 items-center rounded-md border border-input bg-transparent pr-1">
                <input
                  id="login-password"
                  aria-label="Password"
                  type={show ? "text" : "password"}
                  placeholder="••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-full flex-1 border-0 bg-transparent px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
                />
                <span
                  onClick={() => setShow((v) => !v)}
                  role="switch"
                  aria-checked={show}
                  aria-label="Show password"
                  className="cursor-pointer select-none px-3 text-[13px] font-semibold text-primary"
                >
                  {show ? "Hide" : "Show"}
                </span>
              </div>
            </div>
          </div>

          {error ? <p className="mt-3.5 text-sm text-destructive">{error}</p> : null}

          <Button type="submit" disabled={busy} className="mt-6 h-12 w-full rounded-pill text-[15px]">
            {busy ? "Signing in…" : "Sign in"}
          </Button>

          <p className="mt-4 text-center text-xs text-muted-foreground">
            Admin &amp; staff accounts are provisioned by Race Pace.
          </p>
        </form>
      </Card>
    </div>
  );
}
