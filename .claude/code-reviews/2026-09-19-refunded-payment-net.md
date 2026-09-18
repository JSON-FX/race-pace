# Refunded payment net display review

Files modified: 2. Files added: 0. Files deleted: 0. New lines: 23. Deleted lines: 1.

Code review passed. No technical issues detected.

The Payments table now displays zero current net on a fully refunded row. The stored `net_to_org` remains available for payout clawback, and the Net column no longer offers a sort based on that historical value. Paid and partially refunded rows keep their stored current value. The CSV already separates stored ledger net from current net; Settlement and the Payments summary use current figures.

Validation: 14 focused Payments tests passed across three files; admin typecheck passed; `git diff --check` passed. Production UI still shows the old behavior until this change is released.
