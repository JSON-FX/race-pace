# Guide cards and sidebar account review

**Stats:**

- Files Modified: 5
- Files Added: 0
- Files Deleted: 0
- New lines: 71
- Deleted lines: 38

Code review passed. No technical issues detected.

The Guide card's grid alignment keeps thumbnails level with descriptions of different lengths. The account menu uses the existing shadcn Sidebar components and keeps its controls inside the collapsed rail. The avatar comes from the signed-in profile, so changing the active organization does not change it. Focused tests, full app and backend suites, typechecks, the shared component audit, both builds, and the Impeccable detector passed. Hosted interaction and viewport checks remain part of staging acceptance.
