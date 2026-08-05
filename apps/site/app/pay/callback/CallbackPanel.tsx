"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { verifyPayment, useRegistration } from "@/lib/registration";
import { TIMEOUT_MS } from "@/lib/payment";
import { Button } from "@/components/ui/button";

export function CallbackPanel() {
  const router = useRouter();
  const params = useSearchParams();
  const [rid, setRid] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const cancelled = params.get("status") === "cancel";

  // PayMongo returns with our rid, but recover from sessionStorage if it is
  // missing — the runner has already paid at that point and must not be stranded.
  useEffect(() => {
    const fromQuery = params.get("rid");
    setRid(fromQuery ?? sessionStorage.getItem("rp:paying"));
  }, [params]);

  const reg = useRegistration(rid ?? "", { poll: !!rid && !cancelled });
  const verified = useRef(false);

  // Confirm server-side. The redirect itself is never trusted — payment-verify
  // re-fetches the session from PayMongo.
  useEffect(() => {
    if (!rid || cancelled || verified.current) return;
    verified.current = true;
    verifyPayment(rid).then(() => reg.refetch());
  }, [rid, cancelled, reg]);

  useEffect(() => {
    if (!rid || cancelled) return;
    const t = setTimeout(() => setTimedOut(true), TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [rid, cancelled]);

  useEffect(() => {
    if (reg.data?.status === "paid" && rid) {
      sessionStorage.removeItem("rp:paying");
      router.replace(`/ticket/${rid}`);
    }
  }, [reg.data?.status, rid, router]);

  if (cancelled && rid) {
    return (
      <Panel title="Payment cancelled" body="No payment was taken. Your slot is still held — you can try again.">
        <Button asChild className="h-auto rounded-pill px-8 py-4 text-[16px] font-semibold">
          <Link href={`/pay/${rid}`}>Back to payment</Link>
        </Button>
      </Panel>
    );
  }

  if (!rid) {
    return (
      <Panel
        title="We lost track of that payment"
        body="If you completed a payment, it will still be confirmed. Check My Races in a moment."
      >
        <Button asChild className="h-auto rounded-pill px-8 py-4 text-[16px] font-semibold">
          <Link href="/races">Go to My Races</Link>
        </Button>
      </Panel>
    );
  }

  return (
    <Panel
      title="Confirming your payment…"
      body={
        timedOut
          ? "Still processing. If you completed payment, it will confirm shortly — you can also check again."
          : "This usually takes a few seconds."
      }
    >
      <Button
        type="button"
        onClick={() => verifyPayment(rid).then(() => reg.refetch())}
        className="h-auto rounded-pill px-8 py-4 text-[16px] font-semibold"
      >
        Check again
      </Button>
    </Panel>
  );
}

function Panel({ title, body, children }: { title: string; body: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col items-center justify-center px-6 text-center">
      <h1 className="text-[26px] font-semibold tracking-[-0.5px] text-foreground">{title}</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">{body}</p>
      <div className="mt-8">{children}</div>
    </div>
  );
}
