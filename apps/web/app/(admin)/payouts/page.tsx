import { Banknote } from "lucide-react";
import { ComingSoon } from "@/components/coming-soon";

export default function PayoutsPage() {
  return (
    <ComingSoon
      icon={Banknote}
      title="Payouts"
      description="Settlement runs and transfer history for organizers."
    />
  );
}
