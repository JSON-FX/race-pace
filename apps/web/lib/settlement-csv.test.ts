import { describe, it, expect } from "vitest";
import { settlementCsv, type SettlementRow } from "./settlement-csv";

const row = (over: Partial<SettlementRow> = {}): SettlementRow => ({
  registration_id: "r1", runner_name: "Ana Cruz", category: "40K",
  paid_at: "2026-08-01T02:00:00Z", method: "gcash",
  gross_paid: 200000, rp_commission: 6000, processing_fee: 3000, net_to_org: 191000,
  status: "paid", refunded_amount: 0, refunded_at: null, ...over,
});

describe("settlementCsv", () => {
  it("emits a header row followed by one row per registration", () => {
    const lines = settlementCsv([row()]).split("\n");
    expect(lines[0]).toBe(
      "registration_id,runner_name,category,paid_at,method,gross_paid,rp_commission,processing_fee,net_to_org,status,refunded_amount,refunded_at",
    );
    expect(lines).toHaveLength(2);
  });

  it("writes money in PESOS with two decimals, not centavos", () => {
    // A spreadsheet column of raw centavos gets read as pesos by a human and is
    // wrong by a factor of 100 — in a document about money owed.
    expect(settlementCsv([row()]).split("\n")[1]).toContain("2000.00,60.00,30.00,1910.00");
  });

  it("quotes and escapes a name containing a comma or a quote", () => {
    const csv = settlementCsv([row({ runner_name: 'Cruz, Ana "Bing"' })]);
    expect(csv.split("\n")[1]).toContain('"Cruz, Ana ""Bing"""');
  });

  it("renders a null paid_at and method as empty fields, not the string null", () => {
    const line = settlementCsv([row({ paid_at: null, method: null })]).split("\n")[1];
    expect(line).toBe("r1,Ana Cruz,40K,,,2000.00,60.00,30.00,1910.00,paid,0.00,");
  });

  it("emits only the header for an empty result", () => {
    expect(settlementCsv([]).split("\n")).toHaveLength(1);
  });
});
