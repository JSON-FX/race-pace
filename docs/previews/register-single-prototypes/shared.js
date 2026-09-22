const concept = { name: 'Race Bib', label: 'Selected single registration design', layout: 'bib' };
const steps = ['Details', 'Kit', 'Confirm', 'Pay'];
const root = document.getElementById('app');
const state = { step: 1, size: 'XL', firstUltra: false, addon: false, waiver: false, dark: false };
const amount = () => state.addon ? '₱1,950.00' : '₱1,700.00';
const icon = (name) => {
  const paths = {
    arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
    back: '<path d="M19 12H5m6 6-6-6 6-6"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18"/>',
    pin: '<path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    shield: '<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/>',
    shirt: '<path d="m7 3-4 3-1 5 4 2 2-2v10h8V11l2 2 4-2-1-5-4-3-2 3H9L7 3Z"/>',
  };
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.check}</svg>`;
};
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

function renderStepper() {
  return `<nav class="stepper" aria-label="Preview registration steps"><ol>${steps.map((label, index) => { const number = index + 1; return `<li><button type="button" data-step="${number}" class="step-button ${state.step === number ? 'is-current' : ''} ${state.step > number ? 'is-done' : ''}" ${state.step === number ? 'aria-current="step"' : ''}><span class="step-number">${state.step > number ? icon('check') : String(number).padStart(2,'0')}</span><span class="step-label">${label}</span></button></li>`; }).join('')}</ol><p class="step-help">Preview any step</p></nav>`;
}

function renderMasthead() {
  return `<section class="masthead"><div class="masthead-copy"><p class="eyebrow">Yalabyalam Backyard Ultra</p><h1>Your place at the start.</h1><p class="masthead-desc">6.706 km · 28–29 November 2026 · Team Pogi Adventures</p></div><div class="masthead-mark" aria-hidden="true">6<span>.706</span><small>KM / BACKYARD ULTRA</small></div></section>`;
}

function renderSummary() {
  return `<aside class="summary" aria-label="Race and price summary"><div class="summary-top"><span class="summary-eyebrow">Your race pass</span><span class="summary-icon">${icon('pin')}</span></div><h2>Yalabyalam<br> Backyard Ultra</h2><p class="summary-category">6.706 km · Individual entry</p><div class="summary-meta"><div>${icon('calendar')}<span>28–29 Nov 2026</span></div><div>${icon('pin')}<span>Quezon, Bukidnon</span></div></div><div class="summary-total"><span>${state.addon ? 'Entry + photo pack' : 'Entry fee'}</span><strong>${amount()}</strong></div><p class="summary-note">Payment processing is calculated at PayMongo checkout.</p></aside>`;
}

function field(label, value) { return `<div class="passport-field"><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`; }
function renderDetails() {
  return `<div class="section-heading"><span class="section-icon">${icon('user')}</span><div><p class="eyebrow">01 / DETAILS</p><h2>Check your Race Passport</h2><p>Your ticket and emergency details will use this information.</p></div></div>
    <div class="passport-header"><img class="avatar" src="assets/maya-profile-avatar.webp" alt="Maya Santos’s profile photo" width="48" height="48"><div><strong>Maya Santos</strong><span>Race Passport ready</span></div><span class="ready-badge">${icon('check')} Verified details</span></div>
    <div class="field-groups"><section><h3>Runner identity</h3><dl class="passport-grid">${field('First name','Maya')}${field('Last name','Santos')}${field('Team name','North Ridge Runners')}${field('Date of birth','20 November 1995')}${field('Gender','Female')}${field('Contact number','+63 912 345 6789')}</dl></section><section><h3>Safety and booking</h3><dl class="passport-grid">${field('Emergency contact','Alex Santos')}${field('Emergency number','+63 917 555 0101')}${field('Relationship','Sibling')}${field('Booking email','maya@example.com')}</dl></section></div>
    <button type="button" class="text-action" data-dialog="passport">Edit Race Passport ${icon('arrow')}</button>`;
}
function renderKit() {
  return `<div class="section-heading"><span class="section-icon">${icon('shirt')}</span><div><p class="eyebrow">02 / KIT</p><h2>Make this entry yours</h2><p>Choose your kit and answer the event questions.</p></div></div>
    <section class="kit-section"><div class="section-row"><div><h3>Shirt size</h3><p>Choose the size you want on race day.</p></div><span class="required-label">Required</span></div><div class="size-grid" role="group" aria-label="Shirt size">${['XS','S','M','L','XL','XXL'].map(size => `<button type="button" data-size="${size}" aria-pressed="${state.size === size}" class="size-choice ${state.size === size ? 'selected' : ''}">${size}</button>`).join('')}</div></section>
    <section class="kit-section"><div class="section-row"><div><h3>Event question</h3><p>Your answer helps the organizers prepare.</p></div></div><label class="choice-row"><input type="checkbox" id="firstUltra" ${state.firstUltra ? 'checked' : ''}><span class="choice-copy"><strong>First ultra at this distance?</strong><small>You can update this before you confirm.</small></span></label></section>
    <section class="kit-section"><div class="section-row"><div><h3>Optional extras</h3><p>Only selected extras are added to your entry.</p></div></div><button type="button" data-addon class="addon-choice ${state.addon ? 'selected' : ''}" aria-pressed="${state.addon}"><span class="addon-symbol">${icon('check')}</span><span class="choice-copy"><strong>Race day photo pack</strong><small>Example add-on for this design preview</small></span><span class="addon-price">+₱250</span></button></section>`;
}
function row(label, value, strong = false) { return `<div class="review-row ${strong ? 'review-strong' : ''}"><dt>${label}</dt><dd>${value}</dd></div>`; }
function renderConfirm() {
  return `<div class="section-heading"><span class="section-icon">${icon('check')}</span><div><p class="eyebrow">03 / CONFIRM</p><h2>One last look</h2><p>Review the entry before your slot is reserved for payment.</p></div></div>
    <div class="review-grid"><section class="review-card"><div class="review-title"><h3>Runner and kit</h3><button type="button" data-step="1" class="mini-link">Edit details</button></div><dl>${row('Runner','Maya Santos')}${row('Team','North Ridge Runners')}${row('Date of birth','20 Nov 1995')}${row('Emergency contact','Alex Santos · +63 917 555 0101')}${row('Shirt size',state.size)}${row('First ultra?',state.firstUltra ? 'Yes' : 'No')}</dl></section>
    <section class="review-card"><div class="review-title"><h3>Entry cost</h3><button type="button" data-step="2" class="mini-link">Edit kit</button></div><dl>${row('6.706 km entry','₱1,700.00')}${state.addon ? row('Race day photo pack','₱250.00') : ''}${row('Subtotal before processing',amount(),true)}</dl><p class="fine-print">PayMongo calculates its processing fee and final total on its checkout page.</p></section></div>
    <details class="policy-box" open><summary>Refund policy</summary><p>If you cancel, any refund excludes payment processing fees and applicable Race Pace fees. The exact refund depends on the recorded payment. Contact the organizer to request one.</p></details>
    <div class="waiver-choice"><input type="checkbox" id="waiver" ${state.waiver ? 'checked' : ''}><div><label for="waiver">I accept the event waiver and confirm I am medically fit to take part.</label><button type="button" class="inline-link" data-dialog="waiver">Read event waiver</button></div></div><p class="field-error" id="waiverError" role="alert" hidden>Please read and accept the event waiver to continue.</p>`;
}
function renderPay() {
  return `<div class="section-heading"><span class="section-icon">${icon('lock')}</span><div><p class="eyebrow">04 / PAY</p><h2>Finish your entry</h2><p>Your slot is held while you complete the secure checkout.</p></div></div>
    <div class="hold-banner">${icon('shield')}<span><strong>Secure payment with PayMongo</strong><small>You will see the exact processing fee before confirming payment.</small></span></div>
    <div class="pay-grid"><section class="review-card"><h3>Payment summary</h3><dl>${row('Entry fee','₱1,700.00')}${state.addon ? row('Race day photo pack','₱250.00') : ''}${row('Subtotal',amount(),true)}${row('Payment processing','Calculated by PayMongo')}${row('Final total','Shown on PayMongo',true)}</dl></section><section class="pay-methods"><h3>Available at checkout</h3><p>Choose your method on PayMongo after continuing.</p><div class="method-grid" aria-label="Payment methods available on PayMongo">
      <span class="method-item method-qr"><img src="../../../apps/site/public/payments/qr-ph.svg" width="85" height="20" alt="" aria-hidden="true"><span class="visually-hidden">QR Ph</span></span>
      <span class="method-item"><img src="../../../apps/site/public/payments/gcash.png" width="38" height="24" alt="" aria-hidden="true"><span>GCash</span></span>
      <span class="method-item"><img src="../../../apps/site/public/payments/maya.png" width="38" height="24" alt="" aria-hidden="true"><span>Maya</span></span>
      <span class="method-item method-card"><span class="card-marks"><img src="../../../apps/site/public/payments/visa.png" width="38" height="24" alt="" aria-hidden="true"><img src="../../../apps/site/public/payments/mastercard.png" width="38" height="24" alt="" aria-hidden="true"></span><span>Card <span class="visually-hidden">(Visa or Mastercard)</span></span></span>
    </div><p class="fine-print">The preview does not open PayMongo or create a registration.</p></section></div>
    <details class="policy-box"><summary>Refund policy</summary><p>If you cancel, any refund excludes payment processing fees and applicable Race Pace fees. Contact the organizer to request one.</p></details>`;
}
function renderContent() { return [renderDetails, renderKit, renderConfirm, renderPay][state.step - 1](); }
function renderActions() { return `<div class="actions">${state.step > 1 ? `<button type="button" class="button button-back" data-back>${icon('back')} Back</button>` : ''}<button type="button" class="button button-primary" data-next>${state.step === 4 ? 'Preview secure checkout' : state.step === 3 ? 'Continue to Pay' : 'Continue'} ${icon(state.step === 4 ? 'lock' : 'arrow')}</button></div>`; }
function renderPage() {
  document.title = `${concept.name} · Single registration · Race Pace`;
  document.body.classList.toggle('dark', state.dark);
  root.innerHTML = `<header class="site-header"><div class="site-header-inner"><a href="index.html" aria-label="Race Pace registration design preview"><img src="../../../apps/site/public/topnav-logo.png" alt="Race Pace" class="brand-logo" /></a><div class="site-links" aria-label="Site navigation preview"><span>Home</span><span>Races</span><span>My Races</span><span>Profile</span></div><span class="account-chip">Maya S.</span></div></header>
    <div class="concept-toolbar"><span>Race Bib · Single registration design preview</span><button type="button" data-theme aria-label="Switch ${state.dark ? 'to light' : 'to dark'} mode">${state.dark ? 'Light' : 'Dark'} mode</button></div>
    <main class="concept concept-${concept.layout}">${renderMasthead()}<div class="workspace">${renderStepper()}<section class="main-panel" aria-labelledby="stepTitle"><div class="panel-topline"><span>REGISTRATION / SINGLE ENTRY</span><span>STEP 0${state.step} OF 04</span></div><div id="stepTitle" tabindex="-1">${renderContent()}</div>${renderActions()}</section>${renderSummary()}</div><div class="concept-foot"><span>${concept.label}</span><span>Design preview only · No data is saved</span></div></main>
    <dialog id="infoDialog" class="info-dialog"><div class="dialog-head"><h2 id="dialogTitle"></h2><button type="button" data-close aria-label="Close dialog">×</button></div><p id="dialogText"></p><button type="button" class="button button-primary" data-close>Close</button></dialog><div id="toast" class="toast" role="status" aria-live="polite" hidden></div>`;
}
renderPage();

root.addEventListener('click', event => {
  const trigger = event.target.closest('button');
  if (!trigger) return;
  if (trigger.dataset.step) { state.step = Number(trigger.dataset.step); renderPage(); document.getElementById('stepTitle').focus(); window.scrollTo({top: 0, behavior: 'smooth'}); return; }
  if (trigger.dataset.size) { state.size = trigger.dataset.size; renderPage(); document.querySelector(`[data-size="${state.size}"]`).focus(); return; }
  if (trigger.hasAttribute('data-addon')) { state.addon = !state.addon; renderPage(); document.querySelector('[data-addon]').focus(); return; }
  if (trigger.hasAttribute('data-back')) { state.step = Math.max(1, state.step - 1); renderPage(); document.getElementById('stepTitle').focus(); return; }
  if (trigger.hasAttribute('data-next')) {
    if (state.step === 3 && !state.waiver) { const error = document.getElementById('waiverError'); error.hidden = false; document.getElementById('waiver').focus(); return; }
    if (state.step === 4) { const toast = document.getElementById('toast'); toast.hidden = false; toast.textContent = 'Design preview only. No payment or registration was started.'; setTimeout(() => toast.hidden = true, 4500); return; }
    state.step += 1; renderPage(); document.getElementById('stepTitle').focus(); return;
  }
  if (trigger.dataset.dialog) { const dialog = document.getElementById('infoDialog'); document.getElementById('dialogTitle').textContent = trigger.dataset.dialog === 'waiver' ? 'Event waiver' : 'Edit Race Passport'; document.getElementById('dialogText').textContent = trigger.dataset.dialog === 'waiver' ? 'The published event waiver will appear here in the live flow. This preview does not ask you to accept legal terms.' : 'The live flow opens your Race Passport for editing. This preview uses sample runner details.'; dialog.showModal(); return; }
  if (trigger.hasAttribute('data-close')) { document.getElementById('infoDialog').close(); return; }
  if (trigger.hasAttribute('data-theme')) { state.dark = !state.dark; renderPage(); return; }
});
root.addEventListener('change', event => {
  if (event.target.id === 'firstUltra') state.firstUltra = event.target.checked;
  if (event.target.id === 'waiver') { state.waiver = event.target.checked; const error = document.getElementById('waiverError'); if (error) error.hidden = true; }
});
