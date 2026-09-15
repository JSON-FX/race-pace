import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { loadEnv } from '../../test/env';
const {url,serviceKey,anonKey}=loadEnv();
const s=createClient(url,serviceKey,{auth:{persistSession:false}});
async function rpc(name:string,args:Record<string,unknown>){const r=await s.rpc(name,args);if(r.error) throw r.error;return r.data;}
async function fixture(partial=false){
 const stamp=crypto.randomUUID();
 const {data:o,error:oe}=await s.from('organizations').insert({name:'Request test',slug:stamp,refund_policy:partial?'flat_fee':'full',refund_fee_cents:partial?1000:0}).select().single();if(oe)throw oe;
 const {data:e}=await s.from('events').insert({org_id:o.id,name:'Request race',status:'draft'}).select().single();
 const {data:c}=await s.from('categories').insert({org_id:o.id,event_id:e.id,code:'10k',label:'10K',base_price:10000,slots_total:10,slots_taken:1}).select().single();
 const {data:u,error:ue}=await s.auth.admin.createUser({email:`${stamp}@test.dev`,password:'password123',email_confirm:true});if(ue)throw ue;
 const {data:r}=await s.from('registrations').insert({org_id:o.id,event_id:e.id,category_id:c.id,user_id:u.user!.id,total_amount:10000,status:'paid'}).select().single();
 const {error:pe}=await s.from('payments').insert({org_id:o.id,registration_id:r.id,provider:'paymongo',provider_ref:`pay_${stamp}`,amount:10000,status:'paid',method:'gcash',platform_fee:0,processor_fee_cents:250,processor_fee_source:'actual',net_to_org:9750,raw:{unrelated:'preserve'}});if(pe)throw pe;
 return {r,o,c,claim:(extra={})=>rpc('refund_request_claim',{p_registration_id:r.id,p_refunded_by:u.user!.id,p_note:'frozen',p_provider_scope:'key-a',...extra}),pay:async()=> (await s.from('payments').select('*').eq('registration_id',r.id).single()).data!,cleanup:async()=>{await s.from('organizations').delete().eq('id',o.id);await s.auth.admin.deleteUser(u.user!.id);}};
}
async function store(id:string,amount:number,status='succeeded',metadata={},time=10){return rpc('refund_event_store',{p_resource:{id,attributes:{amount,status,metadata,updated_at:time}}});}
const apply=(id:string)=>rpc('refund_request_apply_event',{p_provider_refund_id:id});
describe('durable refund ownership',()=>{
 it('claims one concurrent owner; preview is read-only and terms remain frozen',async()=>{const f=await fixture();try{
  expect((await f.claim({p_preview:true})).action).toBe('preview');
  expect((await s.from('refund_requests').select('*').eq('registration_id',f.r.id)).data).toHaveLength(0);
  const results=await Promise.all(Array.from({length:6},()=>f.claim()));
  expect((await f.pay()).raw.refund.status).toBe('submitting');expect(results.filter(x=>x.action==='submit')).toHaveLength(1);expect(new Set(results.map(x=>x.request.id)).size).toBe(1);
  await s.from('organizations').update({refund_policy:'none'}).eq('id',f.o.id);
  expect((await f.claim()).refund_amount).toBe(9750);
 }finally{await f.cleanup();}});
 it('same request recovers lease, but expiry and key rotation block submission',async()=>{const f=await fixture();try{
  const first=await f.claim();await rpc('refund_request_uncertain',{p_request_id:first.request.id});
  expect((await f.pay()).raw.refund.status).toBe('unknown');expect((await f.claim()).action).toBe('pending');
  await s.from('refund_requests').update({lease_until:new Date(Date.now()-1000).toISOString()}).eq('id',first.request.id);
  const retry=await f.claim();expect(retry.action).toBe('submit');expect(retry.request.id).toBe(first.request.id);
  expect((await f.claim({p_provider_scope:'key-b'})).error).toBe('refund_review_required');
  await s.from('refund_requests').update({created_at:new Date(Date.now()-24*3600000).toISOString()}).eq('id',first.request.id);
  expect((await f.claim()).error).toBe('refund_review_required');
 }finally{await f.cleanup();}});
 it('applies early metadata callback once, preserves partial split and terminal ordering',async()=>{const f=await fixture(true);try{
  const q=(await f.claim()).request,id=`re_${crypto.randomUUID()}`;
  await store(id,8750,'succeeded',{refund_request_id:q.id,registration_id:f.r.id},20);
  expect(await apply(id)).toBe('applied');expect(await apply(id)).toBe('already');
  await store(id,8750,'failed',{},30);expect(await apply(id)).toBe('already');
  expect(await f.pay()).toMatchObject({status:'partially_refunded',net_to_org:1000,refunded_amount:8750,raw:expect.objectContaining({unrelated:'preserve',refund:expect.objectContaining({status:'succeeded'})})});
  expect((await f.claim()).action).toBe('already');
  expect((await s.from('registration_audit').select('*').eq('registration_id',f.r.id).eq('action','partially_refunded')).data).toHaveLength(1);
 }finally{await f.cleanup();}});
 it('retains unmatched callbacks for later binding and rejects wrong amounts/registration',async()=>{const f=await fixture();try{
  const id=`re_${crypto.randomUUID()}`;await store(id,9750);expect(await apply(id)).toBe('unmatched');
  const q=(await f.claim()).request;await rpc('refund_request_bind',{p_request_id:q.id,p_provider_refund_id:id});expect(await apply(id)).toBe('applied');
 }finally{await f.cleanup();}});
 it('invalid metadata and amounts cannot settle or replace a bound ID',async()=>{const f=await fixture();try{
  const q=(await f.claim()).request,id=`re_${crypto.randomUUID()}`;
  await store(id,9751,'succeeded',{refund_request_id:q.id});expect(await apply(id)).toBe('invalid');
  const wrong=`re_${crypto.randomUUID()}`;await store(wrong,9750,'succeeded',{refund_request_id:q.id,registration_id:crypto.randomUUID()});expect(await apply(wrong)).toBe('invalid');
  await rpc('refund_request_bind',{p_request_id:q.id,p_provider_refund_id:'bound_'+id});
  const other=`re_${crypto.randomUUID()}`;await store(other,9750,'succeeded',{refund_request_id:q.id});expect(await apply(other)).toBe('invalid');
  expect((await f.pay()).status).toBe('paid');
 }finally{await f.cleanup();}});
 it('adopts legacy pending frozen amounts and never resubmits',async()=>{const f=await fixture(true);try{
  const id=`re_${crypto.randomUUID()}`;
  await s.from('payments').update({raw:{unrelated:'preserve',refund:{id,status:'pending',refunded_amount:8750,retained_net:1000,note:'legacy'}}}).eq('registration_id',f.r.id);
  expect((await f.claim({p_preview:true})).action).toBe('pending');
  await store(id,8750);expect(await apply(id)).toBe('applied');expect((await f.pay()).net_to_org).toBe(1000);
 }finally{await f.cleanup();}});
 it('failed resources reject nonterminal downgrade but later success is absorbing',async()=>{const f=await fixture();try{
  const q=(await f.claim()).request,id=`re_${crypto.randomUUID()}`;
  await store(id,9750,'failed',{refund_request_id:q.id},20);expect(await apply(id)).toBe('applied');
  await store(id,9750,'pending',{refund_request_id:q.id},30);
  expect((await s.from('refund_provider_events').select('status').eq('provider_refund_id',id).single()).data!.status).toBe('failed');
  await store(id,9750,'succeeded',{refund_request_id:q.id},10);expect(await apply(id)).toBe('applied');
  expect((await f.pay()).status).toBe('refunded');
 }finally{await f.cleanup();}});
 it('missing callback amount cannot apply a refund',async()=>{const f=await fixture();try{
  const q=(await f.claim()).request,id=`re_${crypto.randomUUID()}`;
  await rpc('refund_event_store',{p_resource:{id,attributes:{status:'succeeded',metadata:{refund_request_id:q.id}}}});
  expect(await apply(id)).toBe('invalid');expect((await f.pay()).status).toBe('paid');
 }finally{await f.cleanup();}});
 it('late failed attempt cannot replace retry projection, nor can late binding replace success',async()=>{const f=await fixture();try{
  const a=(await f.claim()).request,aid=`re_${crypto.randomUUID()}`;
  await store(aid,9750,'failed',{refund_request_id:a.id},10);expect(await apply(aid)).toBe('applied');
  const b=(await f.claim()).request;expect(b.id).not.toBe(a.id);
  await store(aid,9750,'failed',{refund_request_id:a.id},20);expect(await apply(aid)).toBe('already');
  await rpc('refund_request_bind',{p_request_id:a.id,p_provider_refund_id:aid});
  expect((await f.pay()).raw.refund).toMatchObject({request_id:b.id,status:'submitting'});
  // A provider correction succeeds A after B was claimed: settle once, then
  // prevent B's in-flight response (or timeout) replacing the winning projection.
  await store(aid,9750,'succeeded',{refund_request_id:a.id},30);expect(await apply(aid)).toBe('applied');
  expect((await f.pay()).raw.refund).toMatchObject({request_id:a.id,status:'succeeded'});
  expect(await rpc('refund_request_bind',{p_request_id:b.id,p_provider_refund_id:`re_${crypto.randomUUID()}`})).toBe('already');
  await rpc('refund_request_uncertain',{p_request_id:b.id});
  expect((await f.pay()).raw.refund).toMatchObject({request_id:a.id,status:'succeeded'});
  expect((await s.from('registration_audit').select('*').eq('registration_id',f.r.id).eq('action','refunded')).data).toHaveLength(1);
 }finally{await f.cleanup();}});
 it('retains distinct second provider success as a review discrepancy after partial settlement',async()=>{const f=await fixture(true);try{
  await s.from('organizations').update({refund_fee_cents:9000}).eq('id',f.o.id);
  const a=(await f.claim()).request,aid=`re_${crypto.randomUUID()}`;
  await store(aid,750,'failed',{refund_request_id:a.id},10);expect(await apply(aid)).toBe('applied');
  const b=(await f.claim()).request,bid=`re_${crypto.randomUUID()}`;
  await store(aid,750,'succeeded',{refund_request_id:a.id},20);expect(await apply(aid)).toBe('applied');
  await store(bid,750,'succeeded',{refund_request_id:b.id},30);expect(await apply(bid)).toBe('review_required');
  expect(await apply(bid)).toBe('review_required');expect(await apply(aid)).toBe('already');
  expect((await f.claim()).error).toBe('refund_review_required');
  expect((await f.pay())).toMatchObject({net_to_org:9000,refunded_amount:750,raw:expect.objectContaining({refund:expect.objectContaining({request_id:a.id,status:'succeeded'})})});
  expect((await s.from('refund_requests').select('review_required').eq('id',b.id).single()).data!.review_required).toBe(true);
 }finally{await f.cleanup();}});
 it('requires configured provider and hides tables and RPCs from clients',async()=>{const f=await fixture();try{
  expect((await f.claim({p_provider_scope:null})).error).toBe('provider_not_configured');expect((await f.claim({p_provider_scope:'unconfigured'})).error).toBe('provider_not_configured');
  const anon=createClient(url,anonKey,{auth:{persistSession:false}});
  expect((await anon.from('refund_requests').select('*')).error).toBeTruthy();
  expect((await anon.rpc('refund_event_store',{p_resource:{id:'forbidden'}})).error).toBeTruthy();
 }finally{await f.cleanup();}});
});
