import { expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { mintTicketToken, verifyTicketToken } from "../functions/_shared/ticket";
import { loadEnv } from "../../test/env";
const { url, anonKey, serviceKey } = loadEnv();
const options={ auth:{ persistSession:false } };
const service=createClient(url,serviceKey,options);
it("books two non-members for one helper, preserves separate tickets and denies unrelated access", async () => {
 const ids:string[]=[], passports:string[]=[], orgId=randomUUID();
 async function account() {
  const email=`assisted-${randomUUID()}@example.com`;
  const created=await service.auth.admin.createUser({ email,password:"password123",email_confirm:true });
  if(created.error) throw created.error;
  ids.push(created.data.user.id);
  const client=createClient(url,anonKey,options);
  const login=await client.auth.signInWithPassword({email,password:"password123"});
  if(login.error) throw login.error;
  return { client, token:login.data.session!.access_token, id:created.data.user.id };
 }
 try {
  const helper=await account(), stranger=await account();
  expect((await service.from("organizations").insert({id:orgId,name:"Assisted checkout QA",slug:orgId})).error).toBeNull();
  const waiver=await service.from("organizer_waiver_versions").insert({org_id:orgId,title:"QA only",body:"Sample test document"}).select().single();
  expect(waiver.error).toBeNull();
  const event=await service.from("events").insert({org_id:orgId,name:"Guest checkout QA",status:"open",waiver_version_id:waiver.data.id}).select().single();
  expect(event.error).toBeNull();
  const category=await service.from("categories").insert({org_id:orgId,event_id:event.data.id,code:"Q",label:"QA",base_price:100000,slots_total:10}).select().single();
  expect(category.error).toBeNull();
  const key=randomUUID();
  const body={event_id:event.data.id,category_id:category.data.id,waiver_version_id:waiver.data.id,waiver_accepted:true,waiver_acceptance_method:"participant_on_helper_device",idempotency_key:key};
  const call=(token:string, payload:object)=>fetch(`${url}/functions/v1/registrations-checkout`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify(payload)});
  const registrations:string[]=[], tokens:string[]=[];
  for(let i=0;i<2;i++) {
   const passport=randomUUID(); passports.push(passport);
   expect((await helper.client.rpc("passport_create_managed",{p_passport_id:passport})).error).toBeNull();
   expect((await helper.client.from("runner_passports").update({first_name:"Guest",last_name:String(i),date_of_birth:"1950-01-01",gender:"Female",contact_number:"09171234567",emergency_contact_name:"Helper",emergency_contact_number:"09171234567",emergency_contact_relationship:"Child"}).eq("id",passport)).error).toBeNull();
   const denied=await call(stranger.token,{...body,participant_passport_id:passport});
   expect(denied.status).toBe(403);
   const missingAcceptance=await call(helper.token,{...body,participant_passport_id:passport,waiver_acceptance_method:"signed_in_self"});
   expect(missingAcceptance.status).toBe(422);
   const response=await call(helper.token,{...body,participant_passport_id:passport});
   expect(response.status,await response.clone().text()).toBe(200);
   const result=await response.json(); registrations.push(result.registration_id);
   const row=await helper.client.from("registrations").select("user_id,booked_by_user_id,participant_passport_id,waiver_acceptance").eq("id",result.registration_id).single();
   expect(row.error).toBeNull();
   expect(row.data).toMatchObject({user_id:null,booked_by_user_id:helper.id,participant_passport_id:passport});
   expect(row.data?.waiver_acceptance).toMatchObject({accepting_name:`Guest ${i}`,booking_actor_id:helper.id,method:"participant_on_helper_device",capacity:"participant"});
   const retry=await call(helper.token,{...body,participant_passport_id:passport});
   expect(retry.status).toBe(409); expect((await retry.json()).registration_id).toBe(result.registration_id);
   expect((await stranger.client.from("registrations").select("id").eq("id",result.registration_id)).data).toEqual([]);
   expect((await stranger.client.rpc("update_registration_fields_tx",{p_registration_id:result.registration_id,p_changes:{shirt_size:"M"}})).data).toBe("forbidden");
   const token=await mintTicketToken({rid:result.registration_id,eid:event.data.id,iat:1},"qa-only-signing-secret"); tokens.push(token);
   expect((await service.rpc("confirm_payment_tx",{p_registration_id:result.registration_id,p_method:"test",p_fee:10000,p_net:90000,p_token:token,p_raw:{qa:true}})).data).toBe("paid");
   expect(await verifyTicketToken(token,"qa-only-signing-secret")).toMatchObject({rid:result.registration_id,eid:event.data.id});
   const verification=await fetch(`${url}/functions/v1/payment-verify`,{method:"POST",headers:{Authorization:`Bearer ${helper.token}`,"content-type":"application/json"},body:JSON.stringify({registration_id:result.registration_id})});
   expect(verification.status).toBe(200);
   const forbidden=await fetch(`${url}/functions/v1/payment-verify`,{method:"POST",headers:{Authorization:`Bearer ${stranger.token}`,"content-type":"application/json"},body:JSON.stringify({registration_id:result.registration_id})});
   expect(forbidden.status).toBe(404);
   expect((await service.from("passport_managers").insert({passport_id:passport,user_id:stranger.id})).error).toBeNull();
   const otherManager=await call(stranger.token,{...body,participant_passport_id:passport});
   expect(otherManager.status).toBe(409);
   const duplicate=await otherManager.json();
   expect(duplicate.error).toBe("participant_already_registered");
   expect(duplicate).not.toHaveProperty("registration_id");
   expect(duplicate).not.toHaveProperty("checkout_url");
  }
  expect(new Set(registrations).size).toBe(2); expect(new Set(tokens).size).toBe(2);
  expect((await helper.client.from("registrations").select("id").eq("user_id",helper.id).eq("event_id",event.data.id)).data).toEqual([]);
  expect((await service.from("categories").select("slots_taken").eq("id",category.data.id).single()).data?.slots_taken).toBe(2);
 } finally {
  await service.from("events").delete().eq("org_id",orgId);
  await service.from("organizer_waiver_versions").delete().eq("org_id",orgId);
  await service.from("organizations").delete().eq("id",orgId);
  if(passports.length) await service.from("runner_passports").delete().in("id",passports);
  for(const id of ids) { await service.from("runner_passports").delete().eq("claimed_user_id",id); await service.auth.admin.deleteUser(id); }
 }
});
