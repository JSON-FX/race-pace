-- Staging-only acceptance evidence. Transactions roll back synthetic changes.
begin;
select set_config('request.jwt.claim.role','service_role',true);
create temporary table qa_expiry_results(check_name text,result text) on commit drop;
do $qa$
declare v_org uuid:='ab3e1d1b-82ef-4cb9-b785-3fa6464516ae'; v_user uuid:='ccaf63bd-8d0c-40ce-9a02-cd07b0ebf811'; v_passport uuid:='a0fa6952-364c-4e3d-a31c-98c3ed2bc07c';
v_event uuid:=gen_random_uuid();v_cat uuid:=gen_random_uuid();v_res uuid; v_batch uuid:=gen_random_uuid();v_app uuid:=gen_random_uuid();v_req jsonb;v_body jsonb;v_result text;v_blocked boolean;
begin
insert into events(id,org_id,name,slug,status,waiver_version_id) values(v_event,v_org,'[TEST] Rollback expiry acceptance',v_event::text,'open','29f46333-3ac5-4a88-881b-3de67c90a681');
insert into categories(id,org_id,event_id,code,label,base_price,slots_total,reservation_enabled,reservation_slots,reservation_fee_cents,reservation_sales_close_at,entry_payment_deadline_at)
values(v_cat,v_org,v_event,'21k','[TEST] Expiry',150000,10,true,5,30000,now()+interval '30 minutes',now()+interval '1 hour');
v_req:=jsonb_build_object('event_id',v_event,'idempotency_key',gen_random_uuid(),'participants',jsonb_build_array(jsonb_build_object('participant_passport_id',v_passport,'category_id',v_cat)));
v_res:=reserve_category_passports(v_user,v_req,'paymongo');
if (select checkout_expires_at from event_reservations where id=v_res)<>(select entry_payment_deadline_at from categories where id=v_cat) then raise exception 'entry cutoff ignored'; end if;
v_body:=jsonb_build_object('idempotencyKey','reservation:'||v_res::text,'paymentMethodTypes',jsonb_build_array('gcash'));
perform reservation_prepare_checkout(v_user,v_res,0,v_body);
update event_reservations set checkout_expires_at=now()-interval '1 second' where id=v_res;
if expire_event_reservation(v_res)<>'provider_unresolved' or (select count(*) from event_capacity_claims(v_event))<>1 then raise exception 'unsafe release'; end if;
v_blocked:=false; begin perform reservation_prepare_checkout(v_user,v_res,0,v_body); exception when check_violation then v_blocked:=true; end;
if not v_blocked then raise exception 'expired checkout dispatched'; end if;
insert into qa_expiry_results values('Unresolved checkout retains its hold and cannot redispatch after expiry','PASS');
update reservation_payments set provider_ref='cs_synthetic_rollback' where reservation_id=v_res;
v_result:=confirm_reservation_payment(v_res,'cs_synthetic_rollback','pay_synthetic_rollback',30000,0,30000,'gcash',jsonb_build_object('racepace_provider_paid_at',(now()+interval '2 hours')::text));
if v_result<>'review_required' then raise exception 'late capture accepted: %',v_result; end if;
insert into qa_expiry_results values('Capture after entry deadline is quarantined for review','PASS');
insert into prescreening_batches(id,org_id,event_id,booked_by_user_id,idempotency_key,checkout_intent,request_snapshot,status,payment_ready_at,payment_deadline_at)
values(v_batch,v_org,v_event,v_user,gen_random_uuid(),'entry','{}','ready',now()-interval '4 days',now()-interval '1 day');
insert into prescreening_applications(id,batch_id,org_id,event_id,category_id,participant_passport_id,booked_by_user_id,participant_name,is_managed,screening_required,decision)
values(v_app,v_batch,v_org,v_event,v_cat,'915d0da7-5201-4647-9055-2621ea3e5ddf',v_user,'Mika QA',true,false,'not_required');
if prescreening_finish_expiry(v_batch)<>'expired' then raise exception 'free unpaid hold not expired'; end if;
if (select released_at from prescreening_applications where id=v_app) is null then raise exception 'expired application still held'; end if;
if prescreening_finish_expiry(v_batch)<>'expired' then raise exception 'expiry replay'; end if;
insert into qa_expiry_results values('Unpaid screening expiry releases only its hold and is replay safe','PASS');
end $qa$;
select * from qa_expiry_results;
rollback;
