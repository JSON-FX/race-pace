-- Recover the real payment instrument for rows written by the redirect path.
--
-- payment-verify passed the literal "paymongo" — the provider, not the
-- instrument — while payments-webhook correctly read source.type. So the method
-- recorded depended on which path happened to confirm the payment, and the admin
-- Payments column would have read "paymongo" for most rows.
--
-- The value is recoverable rather than lost: every confirmation stores the
-- PayMongo payload in payments.raw. Two shapes exist because the two paths park
-- different envelopes — the webhook nests under event.data, payment-verify does
-- not — so both are tried.
--
-- Deliberately narrow: only rows literally equal to 'paymongo' are touched, and
-- only when the payload actually yields a value. A row whose raw genuinely lacks
-- the field keeps 'paymongo', which reads as "unknown" rather than being guessed.

update payments
   set method = raw #>> '{event,data,attributes,payments,0,attributes,source,type}'
 where method = 'paymongo'
   and raw #>> '{event,data,attributes,payments,0,attributes,source,type}' is not null;

update payments
   set method = raw #>> '{attributes,payments,0,attributes,source,type}'
 where method = 'paymongo'
   and raw #>> '{attributes,payments,0,attributes,source,type}' is not null;

update payments
   set method = raw #>> '{data,attributes,payments,0,attributes,source,type}'
 where method = 'paymongo'
   and raw #>> '{data,attributes,payments,0,attributes,source,type}' is not null;
