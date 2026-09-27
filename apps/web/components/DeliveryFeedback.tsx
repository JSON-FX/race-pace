import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import type { TeamState } from "@/lib/actions/team";

export function DeliveryFeedback({ state }: { state: TeamState }) {
  return (
    <div className="basis-full space-y-2 text-sm">
      {state.error && (
        <Alert variant="destructive" role="alert" className=""><AlertDescription>
          {state.error}
        </AlertDescription></Alert>
      )}
      {state.success && <p role="status">{state.success}</p>}
      {state.warning && <Alert role="alert"><AlertDescription>{state.warning}</AlertDescription></Alert>}
      {state.inviteLink && (
        <Label className="grid gap-1">
          One-time sign-in link
          <Input
            aria-label="One-time sign-in link"
            className="w-full border p-2"
            readOnly
            value={state.inviteLink}
            onFocus={(e) => e.target.select()}
          />
        </Label>
      )}
    </div>
  );
}
