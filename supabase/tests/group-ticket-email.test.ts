import {expect,it} from "vitest";
import {renderGroupTicketEmail} from "../functions/_shared/groupTicketEmail";
it("escapes organizer and participant text and labels optional check-in",()=>{
 const result=renderGroupTicketEmail({eventName:'<script>bad</script>',categoryLabel:'A&B',eventDate:null,venue:'<venue>',total:12345,
 tickets:[
  {name:'<img onerror="bad">',categoryLabel:'A&B',reference:'ref',ticketUrl:'https://race.test/ticket/1?a=1&b=2',qrUrl:'https://race.test/qr?token=a&b'},
  {name:'Runner Two',categoryLabel:'30K',reference:'ref2',ticketUrl:'https://race.test/ticket/2',qrUrl:'https://race.test/qr?token=two'},
 ]});
 expect(result.html).not.toContain('<script>');expect(result.html).toContain('&lt;img onerror=&quot;bad&quot;&gt;');expect(result.html).toContain('₱123.45');expect(result.html).toContain('check-in where required');expect(result.html).toContain('2 active participant tickets');
});
it("rejects fewer than two tickets and non-integer totals",()=>{
 expect(()=>renderGroupTicketEmail({eventName:'Race',categoryLabel:'10K',eventDate:null,venue:null,total:1.2,tickets:[]})).toThrow();
 expect(()=>renderGroupTicketEmail({eventName:'Race',categoryLabel:'10K',eventDate:null,venue:null,total:100,tickets:[
  {name:'Solo',categoryLabel:'10K',reference:'one',ticketUrl:'https://race.test/ticket/1',qrUrl:'https://race.test/qr/1'},
 ]})).toThrow();
});

it("uses the approved shell and gives each runner a distinct QR card",()=>{
 const rendered=renderGroupTicketEmail({eventName:'Race',categoryLabel:'14K',eventDate:'2026-09-24',venue:'TrailNorth',total:280000,tickets:[
  {name:'Ana',categoryLabel:'14K',reference:'A1',ticketUrl:'https://race.test/ticket/1',qrUrl:'https://race.test/qr/1'},
  {name:'Ben',categoryLabel:'30K',reference:'B2',ticketUrl:'https://race.test/ticket/2',qrUrl:'https://race.test/qr/2'},
 ]});
 const {html,text}=rendered;
 expect(html).toContain('max-width:600px;background:#fff;border:1px solid #dce4df');
 expect(html).toContain('One booking, everyone included.');
 expect(html).toContain('Ticket 1 of 2');expect(html).toContain('Ticket 2 of 2');
 expect(html).toContain('https://race.test/qr/1');expect(html).toContain('https://race.test/qr/2');
 expect(html).toContain('₱2,800.00');
 expect(text).toContain('Event: Race\nCategory: 14K\nDate · venue: 2026-09-24 · TrailNorth\nOriginal booking total: ₱2,800.00');
 expect(text).toContain('Ticket 1 of 2: Ana\nCategory: 14K\nReference: A1\nView this participant\'s ticket and QR: https://race.test/ticket/1');
 expect(text).toContain('Ticket 2 of 2: Ben\nCategory: 30K\nReference: B2\nView this participant\'s ticket and QR: https://race.test/ticket/2');
});
