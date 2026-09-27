# Organization admin Guide proposals

Status: five local prototypes reviewed. Video Library selected on 2026-09-27; see the [application specification](2026-09-27-org-admin-guide.md).

## Confirmed request

Add an organization admin page named **Guide**. It contains video guides for navigating the admin site. Only super admins create and upload videos with titles and descriptions. Org admins search and browse the guides. The owner confirmed a preference for quick answers and searchable videos, and required Storybook Fieldnotes components.

## Review artifact

[Five interactive proposals](../previews/guide/README.md) preserve the Fieldnotes white admin canvas, forest controls, Apple interface typography, and reusable Fieldnotes component source. Each demonstrates browsing, title/description search, topic filters, sorting, video detail, an empty state, loading/retry, and the super-admin publishing flow.

The five choices are Video Library, Topic Index, Watch Desk, Task Finder, and Compact List. Video Library is recommended as the balance between discovery and fast lookup. The selected prototype will become the implementation contract for layout, responsive behavior, and demonstrated interactions.

## Permission contract for later implementation

Org admins can read published guides and watch their videos. Only super admins can create guides, upload files, edit metadata, and publish. Drafts remain private to super admins. The prototype role switch only demonstrates these states; real authorization must be enforced at the database and storage boundaries as well as the application.

The proposed guides are a platform-maintained shared catalog. Organization-specific business data remains tenant isolated. Storage limits, supported codecs, moderation/lifecycle details, and caption handling remain implementation decisions. The preview's 500 MB MP4/WebM limit is proposed, not a verified storage configuration.

## Verification boundary

Everything is local and uses illustrative titles, durations, and recording placeholders. The existing illustrated 8:43 event-to-ticket tutorial is reused for actual playback and captions. Selected files remain local object URLs and disappear on reload. No application route, database, hosted storage, or production data has changed.

Prototype checks cover all five choices on desktop, tablet, and mobile. Application gates and hosted staging acceptance apply when the selected design is implemented.
