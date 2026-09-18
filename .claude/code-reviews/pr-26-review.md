# PR #26 review — ticket team name and optional check-in confirmation

Reviewed `2926c25` against staging merge `2a50561`. The ticket now reads `team_name` from the frozen registration snapshot. This preserves the participant's event identity if their Passport changes later. A missing team renders as an em dash, while the ticket reference remains visible beneath the QR. The admin event test covers the confirmed native-dialog branch; the cancellation branch was already covered.

**Stats:** 6 files modified, 0 added, 0 deleted, 49 insertions, 29 deletions.

Code review passed. No technical issues detected.

Validation: ticket component and panel tests passed (18 tests); event editor form tests passed (21 tests); both site and admin typechecks passed. Live staging ticket rendering remains to verify after deployment. The browser's native confirmation interrupted automated UI save, so that exact hosted click path remains unverified despite the focused test.
