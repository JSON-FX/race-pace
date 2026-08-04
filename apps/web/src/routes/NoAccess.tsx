import { useAuth } from "../lib/auth";

export function NoAccess() {
  const { signOut } = useAuth();
  return (
    <div className="grid min-h-full place-items-center text-center">
      <div>
        <h1 className="text-[22px] font-bold">No admin access</h1>
        <p className="text-muted-foreground">This account isn't an organizer on Race Pace.</p>
        <button onClick={() => signOut()} className="mt-2">Sign out</button>
      </div>
    </div>
  );
}
