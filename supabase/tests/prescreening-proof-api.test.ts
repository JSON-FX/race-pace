import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadEnv } from "../../test/env";

const { url, anonKey, serviceKey, dbUrl } = loadEnv();
const svc = createClient(url, serviceKey, { auth: { persistSession: false } });
const db = new Client({ connectionString: dbUrl });
const org=randomUUID(),otherOrg=randomUUID(),event=randomUUID(),category=randomUUID();
let user: string,passport: string,token: string,outsider: string,outsiderToken: string,caller: SupabaseClient;
const paths: string[]=[];

async function call(body: unknown, jwt=token) {
  return fetch(`${url}/functions/v1/prescreening-proof`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${jwt}`,apikey:anonKey},body:JSON.stringify(body)});
}
async function prepare() {
  const response=await call({action:"prepare",category_id:category,participant_passport_id:passport});
  const result=await response.json();expect(response.status,JSON.stringify(result)).toBe(200);
  paths.push(result.object_path);return result as {upload_id:string;object_path:string};
}

beforeAll(async()=>{
  if(!["127.0.0.1","localhost"].includes(new URL(url).hostname)) throw new Error("Local Supabase required");
  await db.connect();
  await db.query("select set_config('request.jwt.claim.role','service_role',false)");
  async function account(){
    const email=`proof-${randomUUID()}@test.invalid`,password=`P-${randomUUID()}!`;
    const created=await svc.auth.admin.createUser({email,password,email_confirm:true});if(created.error)throw created.error;
    const client=createClient(url,anonKey,{auth:{persistSession:false}});
    const signed=await client.auth.signInWithPassword({email,password});if(signed.error)throw signed.error;
    return {id:created.data.user.id,token:signed.data.session!.access_token,client};
  }
  const booker=await account(),other=await account();user=booker.id;token=booker.token;caller=booker.client;outsider=other.id;outsiderToken=other.token;
  passport=(await db.query("select id from public.runner_passports where claimed_user_id=$1",[user])).rows[0].id;
  await db.query("insert into public.organizations(id,name,slug) values($1,'Proof testing',$2)",[org,org]);
  await db.query("insert into public.organizations(id,name,slug) values($1,'Unrelated proof organizer',$2)",[otherOrg,otherOrg]);
  await db.query("insert into public.user_roles(user_id,org_id,role) values($1,$2,'admin')",[outsider,otherOrg]);
  const waiver=(await db.query("insert into public.organizer_waiver_versions(org_id,title,body) values($1,'Proof testing','Test waiver') returning id",[org])).rows[0].id;
  await db.query("insert into public.events(id,org_id,name,slug,status,waiver_version_id) values($1,$2,'Proof testing',$3,'open',$4)",[event,org,event,waiver]);
  await db.query("insert into public.categories(id,org_id,event_id,code,label,slots_total,base_price,prescreening_enabled,prescreening_requirement) values($1,$2,$3,'70k','70K',100,100,true,'Complete 50K')",[category,org,event]);
});
afterAll(async()=>{
  if(paths.length)await svc.storage.from("prescreening-proofs").remove(paths);
  await db.query("delete from public.prescreening_applications where event_id=$1",[event]);
  await db.query("delete from public.prescreening_batches where event_id=$1",[event]);
  await db.query("delete from public.prescreening_uploads where event_id=$1",[event]);
  await db.query("delete from public.events where id=$1",[event]);
  await db.query("delete from public.organizer_waiver_versions where org_id=$1",[org]);
  await db.query("delete from public.organizations where id=$1",[org]);
  await db.query("delete from public.organizations where id=$1",[otherOrg]);
  if(user)await svc.auth.admin.deleteUser(user);if(outsider)await svc.auth.admin.deleteUser(outsider);
  await db.end();
});

describe("private proof Edge verification",()=>{
  for(const [extension,mime] of [["png","image/png"],["jpeg","image/jpeg"],["webp","image/webp"]]) {
    it(`fully decodes a ${extension} and denies unrelated access`,async()=>{
      const ticket=await prepare();
      const bytes=readFileSync(new URL(`./fixtures/proofs/valid.${extension}`,import.meta.url));
      const upload=await caller.storage.from("prescreening-proofs").upload(ticket.object_path,bytes,{contentType:mime});expect(upload.error).toBeNull();
      const verified=await call({action:"verify",upload_id:ticket.upload_id});
      expect(verified.status,await verified.clone().text()).toBe(200);
      const denied=await call({action:"view",upload_id:ticket.upload_id},outsiderToken);expect(denied.status).toBe(403);
      const viewed=await call({action:"view",upload_id:ticket.upload_id});expect(viewed.status).toBe(200);
      const {url: signedUrl}=await viewed.json();
      const image=await fetch(signedUrl);expect(image.status).toBe(200);
      expect(Buffer.from(await image.arrayBuffer())).toEqual(bytes);
      expect((await caller.storage.from("prescreening-proofs").download(ticket.object_path)).error).not.toBeNull();
      expect((await caller.storage.from("prescreening-proofs").upload(ticket.object_path,bytes,{contentType:mime,upsert:true})).error).not.toBeNull();
    });
  }
  it("accepts exactly 10 MB and rejects oversized, truncated, and incomplete proofs",async()=>{
    const png=readFileSync(new URL("./fixtures/proofs/valid.png",import.meta.url));
    const exact=Buffer.alloc(10_000_000);png.copy(exact);
    const ticket=await prepare();
    expect((await caller.storage.from("prescreening-proofs").upload(ticket.object_path,exact,{contentType:"image/png"})).error).toBeNull();
    const verified=await call({action:"verify",upload_id:ticket.upload_id});expect(verified.status,await verified.clone().text()).toBe(200);
    const oversized=await prepare();
    expect((await caller.storage.from("prescreening-proofs").upload(oversized.object_path,Buffer.alloc(10_000_001),{contentType:"image/png"})).error).not.toBeNull();
    const invalid=await prepare();
    expect((await caller.storage.from("prescreening-proofs").upload(invalid.object_path,png.subarray(0,35),{contentType:"image/png"})).error).toBeNull();
    expect((await call({action:"verify",upload_id:invalid.upload_id})).status).toBe(422);
    const incomplete=await prepare();expect((await call({action:"verify",upload_id:incomplete.upload_id})).status).toBe(409);
  });
  it("verifies genuine 20MP images across repeated formats without retaining decoded heaps",async()=>{
    for(const name of ["20mp-rgb.png","20mp-progressive.jpeg","20mp.webp","20mp-rgba16.png","20mp-lossless.webp","20mp-rgb.png","48mp.png","48mp.jpeg"]) {
      const ticket=await prepare();
      const bytes=readFileSync(new URL(`./fixtures/proofs/${name}`,import.meta.url));
      const mime=name.endsWith("png")?"image/png":name.endsWith("jpeg")?"image/jpeg":"image/webp";
      expect((await caller.storage.from("prescreening-proofs").upload(ticket.object_path,bytes,{contentType:mime})).error).toBeNull();
      const verified=await call({action:"verify",upload_id:ticket.upload_id});
      expect(verified.status,`${name}: ${await verified.clone().text()}`).toBe(200);
      const record=(await db.query("select size_bytes,content_type,verified_at from prescreening_uploads where id=$1",[ticket.upload_id])).rows[0];
      expect(Number(record.size_bytes)).toBe(bytes.length);expect(record.content_type).toBe(mime);expect(record.verified_at).not.toBeNull();
    }
    const oversized=await prepare(),bytes=readFileSync(new URL("./fixtures/proofs/over20mp.png",import.meta.url));
    expect((await caller.storage.from("prescreening-proofs").upload(oversized.object_path,bytes,{contentType:"image/png"})).error).toBeNull();
    const verified=await call({action:"verify",upload_id:oversized.upload_id});
    expect(verified.status,await verified.clone().text()).toBe(200);
    expect((await db.query("select verified_at from prescreening_uploads where id=$1",[oversized.upload_id])).rows[0].verified_at).not.toBeNull();
  });
  it("allows only the submitted application's own organization reviewer to view proof",async()=>{
    const ticket=await prepare();
    const bytes=readFileSync(new URL("./fixtures/proofs/valid.png",import.meta.url));
    expect((await caller.storage.from("prescreening-proofs").upload(ticket.object_path,bytes,{contentType:"image/png"})).error).toBeNull();
    expect((await call({action:"verify",upload_id:ticket.upload_id})).status).toBe(200);
    await db.query("select prescreening_submit($1,$2)",[user,{event_id:event,idempotency_key:randomUUID(),checkout_intent:"entry",participants:[{category_id:category,participant_passport_id:passport,proof_upload_id:ticket.upload_id}]}]);
    expect((await call({action:"view",upload_id:ticket.upload_id},outsiderToken)).status).toBe(403);
    await db.query("insert into public.user_roles(user_id,org_id,role) values($1,$2,'admin')",[outsider,org]);
    expect((await call({action:"view",upload_id:ticket.upload_id},outsiderToken)).status).toBe(200);
    // Review permission does not grant upload verification or editing rights.
    expect((await call({action:"verify",upload_id:ticket.upload_id},outsiderToken)).status).toBe(403);
    await db.query("delete from public.user_roles where user_id=$1 and org_id=$2",[outsider,org]);
  });
  it("rejects another runner's Passport before issuing an upload ticket",async()=>{
    expect((await call({action:"prepare",category_id:category,participant_passport_id:passport},outsiderToken)).status).toBe(403);
  });
});
