import type { Client } from "pg";

/** Give only this scenario's participants valid admission details. */
export async function completePassports(db: Client, ids: string[]) {
  await db.query(`update public.runner_passports set
    first_name=coalesce(first_name,'Test'), last_name=coalesce(last_name,'Runner'),
    date_of_birth=coalesce(date_of_birth,'1980-01-01'), gender='Female', contact_number='09171234567',
    emergency_contact_name='Test Contact', emergency_contact_relationship='Friend',
    emergency_contact_number='09179876543', shipping_barangay_code='012801001',
    shipping_zip_code='0123', shipping_address_line='Unit 1'
    where id=any($1::uuid[]) or claimed_user_id=any($1::uuid[])`, [ids]);
}
