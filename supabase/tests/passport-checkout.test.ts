import { expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { loadEnv } from "../../test/env";
const { url, anonKey, serviceKey } = loadEnv();
const db = createClient(url, serviceKey, { auth: { persistSession: false } });

it("blocks an incomplete saved Passport before creating a slot hold, even with forged complete input", async () => {
  const email = `passport-checkout-${randomUUID()}@example.com`;
  const account = await db.auth.admin.createUser({ email, password: "password123", email_confirm: true });
  expect(account.error).toBeNull();
  const uid = account.data.user!.id;
  const org = await db.from("organizations").insert({ name: "Passport gate QA", slug: randomUUID() }).select().single();
  expect(org.error).toBeNull();
  try {
    const event = await db.from("events").insert({ org_id: org.data.id, name: "Passport gate", status: "open" }).select().single();
    expect(event.error).toBeNull();
    const category = await db.from("categories").insert({ org_id: org.data.id, event_id: event.data.id, code: "10k", label: "10K", base_price: 100000, slots_total: 10 }).select().single();
    expect(category.error).toBeNull();
    const client = createClient(url, anonKey, { auth: { persistSession: false } });
    const login = await client.auth.signInWithPassword({ email, password: "password123" });
    expect(login.error).toBeNull();
    const identity = { first_name: "QA", last_name: "Runner", date_of_birth: "1950-01-01", gender: "Female", contact_number: "09171234567", emergency_contact_name: "QA Contact", emergency_contact_number: "09171234567", emergency_contact_relationship: "Child", shipping_barangay_code: "012801001", shipping_zip_code: "0123", shipping_address_line: "Unit 1, Sample Street" };
    const body = { event_id: event.data.id, category_id: category.data.id, waiver_accepted: true, custom_data: identity, idempotency_key: randomUUID() };
    const call = () => fetch(`${url}/functions/v1/registrations-checkout`, { method: "POST", headers: { Authorization: `Bearer ${login.data.session!.access_token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    const missingWaiver = await call();
    expect(missingWaiver.status).toBe(409);
    expect((await missingWaiver.json()).error).toBe("event_waiver_unavailable");
    const waiver = await db.from("organizer_waiver_versions").insert({ org_id: org.data.id, title: "QA version", body: "Sample acceptance text", published_by: uid }).select().single();
    expect(waiver.error).toBeNull();
    expect((await db.from("events").update({ waiver_version_id: waiver.data.id }).eq("id", event.data.id)).error).toBeNull();
    Object.assign(body, { waiver_version_id: waiver.data.id });
    expect((await db.from("events").update({ status: "draft" }).eq("id", event.data.id)).error).toBeNull();
    const draft = await call();
    expect(draft.status).toBe(409);
    expect((await draft.json()).error).toBe("registration_closed");
    expect((await db.from("events").update({ status: "open" }).eq("id", event.data.id)).error).toBeNull();
    const rejected = await call();
    expect(rejected.status).toBe(422);
    expect((await rejected.json()).error).toBe("passport_incomplete");
    expect((await db.from("registrations").select("id").eq("event_id", event.data.id)).data).toEqual([]);
    expect((await db.from("categories").select("slots_taken").eq("id", category.data.id).single()).data?.slots_taken).toBe(0);

    // A valid saved Passport reaches event-question validation. Stop there to
    // prove gate behavior without creating an external payment session.
    expect((await db.from("runner_passports").update(identity).eq("claimed_user_id", uid)).error).toBeNull();
    const question = await db.from("form_fields").insert({ org_id: org.data.id, event_id: event.data.id, key: "qualifier", label: "Qualifier", type: "text", required: true });
    expect(question.error).toBeNull();
    const progressed = await call();
    expect(progressed.status).toBe(400);
    expect((await progressed.json()).error).toBe("invalid_custom_data");
    Object.assign(body.custom_data, { qualifier: "QA", first_name: "Forged", contact_number: "000" });
    const accepted = await call();
    expect(accepted.status).toBe(200);
    const result = await accepted.json();
    const snapshot = await db.from("registrations").select("custom_data,waiver_version_id,waiver_acceptance").eq("id", result.registration_id).single();
    expect(snapshot.error).toBeNull();
    expect(snapshot.data?.waiver_version_id).toBe(waiver.data.id);
    expect(snapshot.data?.waiver_acceptance).toMatchObject({ accepting_name: "QA Runner", booking_actor_id: uid, capacity: "participant" });
    expect(snapshot.data?.custom_data.first_name).toBe("QA");
    expect(snapshot.data?.custom_data.contact_number).toBe("09171234567");
  } finally {
    await db.from("events").delete().eq("org_id", org.data.id);
    await db.from("organizer_waiver_versions").delete().eq("org_id", org.data.id);
    await db.from("organizations").delete().eq("id", org.data.id);
    await db.from("runner_passports").delete().eq("claimed_user_id", uid);
    await db.auth.admin.deleteUser(uid);
  }
});
