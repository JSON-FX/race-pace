# Guide upload progress and 100 MB follow-up

## Changes

The uploader reports real multipart transfer progress through the canonical Fieldnotes Progress adapter. A numeric accessible value and visible percentage follow actual byte events; finishing, thumbnail preparation and guide saving remain distinct phases. Failure clears the progress and unlocks retry. Previously uploaded media is retained after a metadata save failure.

The client, local Storage configuration and additive bucket migration use 100,000,000 bytes. Existing uncapped non-Guide buckets are pinned at their previous 52,428,800-byte effective cap before the hosted global cap is raised. Explicit lower caps are preserved. Existing permissions, MIME types, immutable paths, maximum duration and signed playback are unchanged. No dependencies or privileged browser credentials were added.

## Validation

- Frozen dependency install passed.
- Site and web typechecks passed.
- Runner: 483 tests passed.
- Admin: 995 tests passed. One unrelated organization-dialog test timed out during the first full run; the complete unchanged suite passed with two workers.
- Backend/shared: 777 tests passed with local fake providers.
- Isolated replay: all 159 migrations applied; retired push job and legacy vault key absent. The existing CI assertion was privately adapted only to the isolated 54722 port.
- Both optimized Next builds passed.
- Focused boundary/transport/UI coverage: 41 passing tests. Covers exactly 100 MB, one byte above, intermediate percentage, unknown total, HTTP/network/abort failure, expired session, accessible progress and retained metadata retry.
- Technical review passed with no findings.
- Canonical Fieldnotes progress inspected through Browser in the existing Storybook catalog. Local Browser rejected 100,000,001 bytes, accepted 100,000,000 bytes and saved a real draft with thumbnail and measured duration. Computer opened the same fixture in VLC and confirmed native 8:43 playback. Browser found feedback below the dialog fold; the progress block was moved beside the file field. Consuming hosted staging upload/visual acceptance remains pending.

## Intentional implementation choices

The installed Supabase SDK exposes no upload callback. Native XMLHttpRequest sends its same multipart format and existing bearer token while preserving Storage authorization. The consumer adds the canonical component's missing Radix root value binding for accessible progress. Resumable, pause/cancel and background upload behavior are outside the requested scope.

## Release gate

Apply migration 20260927025643 and read back bucket limits before raising the staging global cap. Complete actual 100 MB Browser upload, increasing bar, save, playback, permission denial, responsive checks and task-only cleanup. Production promotion follows only after staging passes. Production checks must create no synthetic records or payment.
