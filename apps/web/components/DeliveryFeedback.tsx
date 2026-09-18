import type { TeamState } from "@/lib/actions/team";

export function DeliveryFeedback({ state }: { state: TeamState }) {
  return (
    <div className="basis-full space-y-2 text-sm">
      {state.error && (
        <p role="alert" className="text-destructive">
          {state.error}
        </p>
      )}
      {state.success && <p role="status">{state.success}</p>}
      {state.warning && <p role="alert">{state.warning}</p>}
      {state.inviteLink && (
        <label className="grid gap-1">
          One-time sign-in link
          <input
            aria-label="One-time sign-in link"
            className="w-full rounded-lg border bg-background p-2"
            readOnly
            value={state.inviteLink}
            onFocus={(e) => e.target.select()}
          />
        </label>
      )}
    </div>
  );
}
