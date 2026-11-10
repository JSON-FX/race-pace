# Registration CSV participant fields

Admin → Registrations → Export CSV must include First Name, Last Name, Gender,
Age, Birthday, Category, Shirt Size, and Team Name. Keep the existing identity,
email, payment, discount, and reference columns. Place the eight participant
columns together in the requested order after Email.

Use the registration's `custom_data` snapshot for separate names, gender,
birthday, shirt size, and team name. Never split a historical full name or read
the booking account's passport to guess participant data. Missing or malformed
snapshot values export as empty cells. Birthday uses `YYYY-MM-DD`.

The owner selected age on race day. Calculate completed years using the selected
event's `event_date`, with date-only arithmetic independent of runtime timezone.
A February 29 birthday advances on March 1 in non-leap years. Missing, invalid,
or post-race birth dates leave Age blank. An unavailable event date leaves Age
blank; a failed event-date query returns an error before streaming any CSV.

Keep caller-scoped authorization, organization isolation, current filters,
batching, streaming, CSV escaping, and formula protection. No database, provider,
or UI layout changes are needed. Delivery and release remain separate actions.
