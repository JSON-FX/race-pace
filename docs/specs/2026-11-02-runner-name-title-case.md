# Runner names in Title Case

Status: implemented and locally verified. Hosted acceptance pending. Scope approved in chat on 2026-11-02.

Runner first, last and full names use Title Case in saved Passports, profiles, registrations and participant labels. Existing values receive the same conversion through an additive migration. Google account names use this format when displayed from provider metadata.

- Trim surrounding whitespace and collapse internal whitespace.
- Capitalize each sequence of letters, including names joined by hyphens or straight/curly apostrophes. Preserve punctuation and Unicode letters.
- Keep final Roman suffixes II through X uppercase, with an optional final period.
- Do not guess cultural spelling exceptions such as McDonald or lowercase surname particles. `DE LA CRUZ` becomes `De La Cruz`.
- Preserve nulls, missing fields and non-string JSON values. Do not invent missing first/last names.
- Preserve bib names, team names, emails, identifiers, addresses, emergency contacts, provider metadata, waiver acceptance and audit records.

Examples: `SHEEN KIERBY JOVEN BORNEA` becomes `Sheen Kierby Joven Bornea`; `ANA-MARIE O’NEILL III` becomes `Ana-Marie O’Neill III`.

Database triggers enforce direct client/service writes. Shared validation formats new single/group registration input before checkout. The account-list fallback formats Google's display name without modifying the external identity. The runner banner must retain saved casing.

Release requires local checks and hosted staging acceptance before production approval. The owner authorized committing and publishing to staging and production on 2026-11-02; the protected production approval remains a separate action after staging acceptance.
