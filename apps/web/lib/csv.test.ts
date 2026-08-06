import { describe, it, expect } from "vitest";
import { csvField, csvRow, centavosToDecimal } from "./csv";

describe("csvField", () => {
  it("leaves a plain field untouched", () => {
    expect(csvField("Ana Cruz")).toBe("Ana Cruz");
  });

  it("returns empty string for null/undefined", () => {
    expect(csvField(null)).toBe("");
    expect(csvField(undefined)).toBe("");
  });

  it("quotes and doubles a field containing a comma — the runner-name regression", () => {
    // The exact failure mode called out in the task: "Dela Cruz, Ana" must
    // not shift every subsequent column when the row is joined with commas.
    expect(csvField("Dela Cruz, Ana")).toBe('"Dela Cruz, Ana"');
  });

  it("quotes and doubles a field containing a double-quote", () => {
    expect(csvField('Quote "Test" Runner')).toBe('"Quote ""Test"" Runner"');
  });

  it("quotes a field containing a newline", () => {
    expect(csvField("line one\nline two")).toBe('"line one\nline two"');
  });

  it("quotes a field containing a carriage return", () => {
    expect(csvField("line one\rline two")).toBe('"line one\rline two"');
  });

  it("quotes a field with leading/trailing whitespace so it round-trips exactly", () => {
    expect(csvField("  Ana  ")).toBe('"  Ana  "');
  });

  it("handles a field with both a comma and embedded quotes", () => {
    expect(csvField('Cruz, "Ana" M.')).toBe('"Cruz, ""Ana"" M."');
  });

  describe("CSV/formula injection guard", () => {
    // A field beginning =, +, -, or @ is executed as a formula by Excel and
    // Google Sheets (OWASP "CSV Injection"). Mitigation: prefix with a
    // single quote, which every mainstream spreadsheet renders as "force
    // text" (the quote itself is not shown) rather than stripping the
    // content or rejecting the export outright.
    it("neutralizes a leading '='", () => {
      expect(csvField("=SUM(A1:A9)")).toBe("'=SUM(A1:A9)");
    });

    it("neutralizes a leading '+'", () => {
      expect(csvField("+1+1")).toBe("'+1+1");
    });

    it("neutralizes a leading '-'", () => {
      expect(csvField("-2+3")).toBe("'-2+3");
    });

    it("neutralizes a leading '@', quoting too since the value also has a comma", () => {
      // "@SUM(1,2)" — prefixed to "'@SUM(1,2)", which then ALSO needs RFC
      // 4180 quoting because it contains a comma. Written as a template
      // literal (not a hand-escaped '/" string) so the expected character
      // order — outer double-quotes wrapping a leading apostrophe — isn't
      // itself ambiguous to read.
      expect(csvField("@SUM(1,2)")).toBe(`"'@SUM(1,2)"`);
    });

    it("neutralizes a leading tab", () => {
      expect(csvField("\t=cmd")).toBe("'\t=cmd");
    });

    it("combines the injection prefix with comma-quoting when both apply", () => {
      // "=cmd|calc, x" — starts with '=' AND contains a comma. The apostrophe
      // prefix is applied first, then the whole (now longer) value still
      // needs RFC 4180 quoting because of the comma.
      expect(csvField("=cmd|calc, x")).toBe(`"'=cmd|calc, x"`);
    });

    it("does not touch a value that merely CONTAINS one of the guarded characters mid-string", () => {
      expect(csvField("Team A-Team")).toBe("Team A-Team");
      expect(csvField("user@example.com")).toBe("user@example.com");
    });
  });
});

describe("csvRow", () => {
  it("joins fields with commas and terminates with CRLF", () => {
    expect(csvRow(["a", "b", "c"])).toBe("a,b,c\r\n");
  });

  it("produces a row where an embedded comma cannot be mistaken for a delimiter", () => {
    const row = csvRow([csvField("Dela Cruz, Ana"), csvField("21K"), "150000.00"]);
    // Exactly 3 top-level fields once properly CSV-parsed, not 4.
    expect(row).toBe('"Dela Cruz, Ana",21K,150000.00\r\n');
  });
});

describe("centavosToDecimal", () => {
  it("converts a clean amount", () => {
    expect(centavosToDecimal(150000)).toBe("1500.00");
  });

  it("converts an amount with real cents", () => {
    expect(centavosToDecimal(14250)).toBe("142.50");
  });

  it("handles zero", () => {
    expect(centavosToDecimal(0)).toBe("0.00");
  });

  it("handles a negative amount with the sign outside the digits", () => {
    expect(centavosToDecimal(-500)).toBe("-5.00");
  });
});
