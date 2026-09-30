"use client";

import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function ReservationStatusPanel({ id, initialStatus, returned, remaining, categoryBound = false }: {
  id: string; initialStatus: string; returned: boolean; remaining: number; categoryBound?: boolean;
}) {
  const [status, setStatus] = useState(initialStatus);
  const router = useRouter();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [manualCheck, setManualCheck] = useState(0);

  useEffect(() => {
    setStatus(initialStatus);
    if (initialStatus !== "pending") return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const delays = [2000, 5000, 10000, 20000, 30000];
    let attempt = 0;
    async function verify() {
      setChecking(true);
      setError(null);
      let nextStatus: string | undefined;
      try {
        const { data, error: verifyError } = await createClient().functions.invoke("reservation-verify", {
          body: { reservation_id: id },
        });
        if (disposed) return;
        if (verifyError || !data?.status) throw new Error("verification_unavailable");
        nextStatus = data.status;
        setStatus(data.status);
        if (data.status === "paid" || data.status === "converted") router.refresh();
      } catch {
        if (!disposed) setError("Payment could not be checked yet. Please try again shortly.");
      } finally {
        if (!disposed) setChecking(false);
      }
      // Closing a wallet need not return to this page. Every pending visit gets
      // bounded verification; delayed provider visibility gets another chance.
      if (!disposed && (!nextStatus || nextStatus === "pending") && attempt < delays.length) {
        timer = setTimeout(() => { void verify(); }, delays[attempt++]);
      }
    }
    void verify();
    return () => { disposed = true; clearTimeout(timer); };
  }, [id, initialStatus, returned, manualCheck, router]);

  return <div className="mt-6 rounded-xl border border-white/15 bg-white/5 p-5">
    <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-300">Reservation status</p>
    <p className="mt-2 text-2xl font-black capitalize">{status.replaceAll("_", " ")}</p>
    <p className="mt-2 text-sm leading-relaxed text-white/70">
      {status === "converted" ? "Your held places are complete. Converted entries and tickets are in My Races."
        : status === "paid" ? `${remaining} event ${remaining === 1 ? "place is" : "places are"} held. ${categoryBound ? "Your selected categories are saved. Complete entry details and pay for entry when registration is open, before each participant’s deadline." : "Choose an available category for each Race Passport when registration opens, then pay for entry before the deadline."}`
        : status === "pending" ? "Your checkout is still pending. A reservation is secured only after PayMongo confirms payment."
        : status === "review_required" ? "We received a payment update that needs review. Your selected places remain held while we reconcile it."
        : "This reservation no longer holds an event place."}
    </p>
    {status === "pending" ? <Button variant="ghost" type="button" onClick={() => setManualCheck((count) => count + 1)} disabled={checking}
      className="mt-4 px-5 py-2.5 disabled:opacity-50">
      {checking ? "Checking…" : "Check payment"}
    </Button> : null}
    {error ? <Alert role="alert" className="mt-3"><AlertDescription>{error}</AlertDescription></Alert> : null}
  </div>;
}
