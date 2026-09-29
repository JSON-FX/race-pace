-- Staging-only acceptance evidence. Transactions roll back synthetic changes.
begin;
select set_config('request.jwt.claim.role','service_role',true);
create temporary table qa_screening_results(check_name text,result text) on commit drop;
do $qa$
declare
v_org uuid := 'ab3e1d1b-82ef-4cb9-b785-3fa6464516ae';
v_booker uuid := 'ccaf63bd-8d0c-40ce-9a02-cd07b0ebf811';
v_passport uuid := 'a0fa6952-364c-4e3d-a31c-98c3ed2bc07c';
v_event uuid := gen_random_uuid(); v_category uuid := gen_random_uuid(); v_upload uuid := gen_random_uuid();
v_batch uuid; v_app uuid; v_deadline timestamptz; v_request jsonb; v_before record; v_after record; v_blocked boolean;
begin
insert into events(id,org_id,name,slug,status,waiver_version_id) values(v_event,v_org,'[TEST] Rollback deadline acceptance',v_event::text,'open','29f46333-3ac5-4a88-881b-3de67c90a681');
insert into categories(id,org_id,event_id,code,label,base_price,slots_total,prescreening_enabled,prescreening_requirement,reservation_enabled,reservation_slots,reservation_fee_cents,reservation_sales_close_at,entry_payment_deadline_at)
values(v_category,v_org,v_event,'70k','[TEST] 70K',350000,100,true,'Synthetic requirement',true,20,50000,now()+interval '10 days',now()+interval '20 days');
insert into prescreening_uploads(id,org_id,event_id,category_id,participant_passport_id,booked_by_user_id,object_path,size_bytes,content_type,verified_at)
values(v_upload,v_org,v_event,v_category,v_passport,v_booker,v_org::text||'/'||v_booker::text||'/'||v_upload::text,100,'image/png',now());
v_request := jsonb_build_object('event_id',v_event,'idempotency_key',gen_random_uuid(),'checkout_intent','reservation','participants',jsonb_build_array(jsonb_build_object('participant_passport_id',v_passport,'category_id',v_category,'proof_upload_id',v_upload)));
v_batch:=prescreening_submit(v_booker,v_request);
select id into v_app from prescreening_applications where batch_id=v_batch;
if (select count(*) from event_capacity_claims(v_event))<>1 then raise exception 'hold missing'; end if;
if prescreening_finish_expiry(v_batch)<>'reviewing' then raise exception 'review expired'; end if;
insert into qa_screening_results values('Pending review keeps its slot without expiry','PASS');
select * into v_before from category_availability(v_event);
update categories set reservation_sales_close_at=now()-interval '1 hour',entry_payment_deadline_at=now()+interval '1 day' where id=v_category;
select * into v_after from category_availability(v_event);
if v_before.general_available<>80 or v_after.general_available<>99 or v_after.reservation_available<>0 or (select count(*) from event_capacity_claims(v_event))<>1 then raise exception 'cutoff allocation'; end if;
insert into qa_screening_results values('Sales cutoff releases only unsold allocation','PASS');
perform set_config('request.jwt.claim.sub','f70a348b-097c-4f8b-8f39-600fc016c9d1',true);
v_blocked:=false;
begin perform prescreening_review(v_app,'approved',null); exception when check_violation then v_blocked:=true; end;
if not v_blocked or (select decision from prescreening_applications where id=v_app)<>'pending' then raise exception 'deadline extension not enforced'; end if;
update categories set entry_payment_deadline_at=now()+interval '10 days' where id=v_category;
perform prescreening_review(v_app,'approved',null);
select payment_deadline_at into v_deadline from prescreening_batches where id=v_batch;
if (select payment_deadline_at-payment_ready_at from prescreening_batches where id=v_batch)<>interval '72 hours' then raise exception 'wrong timer'; end if;
perform prescreening_review(v_app,'approved',null);
perform prescreening_refresh_ready(v_batch);
if (select payment_deadline_at from prescreening_batches where id=v_batch)<>v_deadline then raise exception 'timer reset'; end if;
insert into qa_screening_results values('Late approval requires extension and preserves one 72-hour deadline','PASS');
v_blocked:=false;
begin delete from categories where id=v_category; exception when check_violation then v_blocked:=true; end;
if not v_blocked then raise exception 'held category deleted'; end if;
insert into qa_screening_results values('Held category cannot be deleted','PASS');
end $qa$;
select * from qa_screening_results;
rollback;
