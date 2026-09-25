# Platform user Passport details review

Scope: the `/users` inspector, its `PlatformPassport` response, the `platform-users` projection, and matching documentation.

Stats: 8 files modified; 0 files added; 0 files deleted before this report. The change is read-only and keeps the existing super-admin authorization check before the service-role query.

Code review passed. No technical issues detected in the changed behavior. The two Passport queries share one projection. The local database accepted that projection, including all four PSGC name joins. The UI renders missing values explicitly, labels managed email as unverified, and lets multiple Passport disclosures stay open independently.

Validation: runner and admin typechecks, 468 runner tests, 917 admin tests, and both production builds passed. Desktop and 320px phone browser checks found no page errors or horizontal overflow after a mobile tab and footer adjustment. With CI-style fake function secrets, the backend suite passed 757 of 758 cases. One unrelated Storage upload test failed with database error `42P10` in the shared local stack. Hosted staging and production remain unchanged.
