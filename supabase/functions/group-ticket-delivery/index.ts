import { serviceClient } from "../_shared/supabase.ts";
import { isAuthorizedBearer } from "../_shared/authz.ts";
import { renderTicketEmail, sendEmail } from "../_shared/email.ts";
import { renderGroupTicketEmail } from "../_shared/groupTicketEmail.ts";
function baseUrl(name: string): string {
  const value=Deno.env.get(name); if (!value) throw new Error("email_not_configured");
  const url=new URL(value);
  if (!["http:","https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("invalid_email_url");
  return url.toString().replace(/\/$/,"");
}
Deno.serve(async req=>{
  const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});
  if (!isAuthorizedBearer(req.headers.get("Authorization"),Deno.env.get("TICKET_EMAIL_SECRET"))) return json({error:"unauthorized"},401);
  if(req.method!=="POST") return json({error:"method_not_allowed"},405);
  if(Deno.env.get("GROUP_TICKET_DELIVERY_ENABLED")!=="true") return json({error:"group_delivery_disabled"},503);
  try {
    const site=baseUrl("PUBLIC_SITE_URL"),functions=baseUrl("PUBLIC_FUNCTIONS_URL");
    const db=serviceClient();
    // One job per invocation bounds SMTP timeout below the lease duration.
    const claim=await db.rpc("booking_delivery_claim",{p_limit:1});
    if(claim.error) return json({error:"delivery_claim_failed"},503);
    let sent=0,skipped=0,failed=0;
    for(const job of claim.data??[]) {
      let reason:string|null=null;
      try {
        const order=await db.from("booking_orders").select("booked_by_user_id,status,event_id").eq("id",job.booking_order_id).single();
        if(order.error || !order.data || order.data.status!=="paid") throw new Error("paid_order_required");
        const [registrations,capture,event,booker]=await Promise.all([
          db.from("registrations").select("id,status,ticket_token,custom_data,categories(label)").eq("booking_order_id",job.booking_order_id).order("id"),
          db.from("booking_payment_captures").select("id,capture").eq("booking_order_id",job.booking_order_id).eq("state","fulfilled").single(),
          db.from("events").select("name,event_date,venue").eq("id",order.data.event_id).single(),
          db.auth.admin.getUserById(order.data.booked_by_user_id),
        ]);
        if(registrations.error || capture.error || event.error || booker.error || !registrations.data?.length) throw new Error("delivery_read_failed");
        const active=registrations.data.filter(r=>r.status==="paid");
        if(registrations.data.some(r=>!["paid","refunded"].includes(r.status)) || active.some(r=>!r.ticket_token)) throw new Error("tickets_not_ready");
        if(active.length===0) { skipped++; }
        else {
          const to=booker.data.user?.email;
          if(!to || !booker.data.user.email_confirmed_at) throw new Error("confirmed_booking_email_required");
          const labels=[...new Set(active.map(r=>Array.isArray(r.categories)?r.categories[0]?.label:r.categories?.label).filter(Boolean))];
          const tickets=active.map(r=>({name:typeof r.custom_data?.full_name==="string"?r.custom_data.full_name:"Participant",categoryLabel:(Array.isArray(r.categories)?r.categories[0]?.label:r.categories?.label)||"Category",reference:r.id.slice(0,8).toUpperCase(),ticketUrl:`${site}/ticket/${r.id}`,qrUrl:`${functions}/ticket-qr?token=${encodeURIComponent(r.ticket_token)}`}));
          let rendered;
          if(tickets.length===1) {
            const registration=active[0],ticket=tickets[0];
            if(!registration || !ticket) throw new Error("delivery_read_failed");
            const allocation=await db.from("booking_payment_allocations").select("gross_cents").eq("registration_id",registration.id).single();
            if(allocation.error || !allocation.data || !Number.isSafeInteger(allocation.data.gross_cents) || allocation.data.gross_cents<0) throw new Error("delivery_read_failed");
            rendered=renderTicketEmail({participantName:ticket.name,eventName:event.data.name,categoryLabel:ticket.categoryLabel,eventDate:event.data.event_date,venue:event.data.venue,
              total:allocation.data.gross_cents,reference:ticket.reference,ticketUrl:ticket.ticketUrl,qrUrl:ticket.qrUrl});
          } else {
            rendered=renderGroupTicketEmail({eventName:event.data.name,categoryLabel:labels.join(" · ")||"Selected categories",eventDate:event.data.event_date,venue:event.data.venue,
              total:capture.data.capture.amount,tickets});
          }
          const result=await sendEmail(to,rendered.subject,rendered.html,rendered.text);
          if(!result.ok) throw new Error("email_transport_failed");
          sent++;
        }
      } catch { reason="delivery_failed"; failed++; }
      const finish=await db.rpc("booking_delivery_finish",{p_order:job.booking_order_id,p_lease:job.lease_token,p_error:reason});
      if(finish.error || finish.data!==true) return json({error:"delivery_completion_unknown"},503);
    }
    return json({sent,skipped,failed},failed?503:200);
  } catch { return json({error:"delivery_unavailable"},503); }
});
