import { describe, expect, it } from "vitest";
import { registrationIdentity } from "./index";

describe("registration identity", () => {
  it("keeps entered identity when the profile is absent or changes", () => {
    const snapshot = { full_name: " QA Runner ", bib_name: " QA BIB " };
    expect(registrationIdentity(snapshot)).toEqual({ full_name: "QA Runner", bib_name: "QA BIB" });
    expect(registrationIdentity(snapshot, { full_name: "Changed", bib_name: "NEW" }))
      .toEqual({ full_name: "QA Runner", bib_name: "QA BIB" });
  });
  it("falls back for legacy, empty, or malformed snapshots", () => {
    const profile = { full_name: "Legacy Runner", bib_name: "LEGACY" };
    expect(registrationIdentity(null, profile)).toEqual(profile);
    expect(registrationIdentity({ full_name: "  ", bib_name: 4 }, profile)).toEqual(profile);
  });
});
