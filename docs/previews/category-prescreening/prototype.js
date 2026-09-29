/* Local interaction proposal only. No API calls, persistence, email, or payment integration. */
(() => {
  'use strict';
  const $ = (s, root = document) => root.querySelector(s.replace(/^#([0-9][\w-]*)/, (_, id) => `#${CSS.escape(id)}`));
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const e = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const money = value => new Intl.NumberFormat('en-PH', {style:'currency',currency:'PHP',maximumFractionDigits:0}).format(value);
  const NOW = Date.parse('2026-10-01T01:00:00Z');
  const MAX_FILE = 10000000;
  const formatDate = value => new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(value));
  const localDate = value => value ? formatDate(`${value}:00+08:00`) : 'Set a deadline';
  const paths = {
    grid:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
    calendar:'M8 2v4 M16 2v4 M3 10h18 M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z',
    list:'M9 6h12 M9 12h12 M9 18h12 M3 6h.01 M3 12h.01 M3 18h.01',
    wallet:'M20 8V5a2 2 0 0 0-2-2H5a3 3 0 0 0 0 6h16v11H5a3 3 0 0 1-3-3V6 M17 13h4 M16 13h.01',
    box:'m3 7 9 5 9-5 M12 12v10 M3 7v10l9 5 9-5V7l-9-5-9 5Z',
    qr:'M3 3h6v6H3z M15 3h6v6h-6z M3 15h6v6H3z M15 15h3v3h3v3h-6z',
    users:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M17 4a4 4 0 0 1 0 7 M22 21v-2a4 4 0 0 0-3-4',
    settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1 1-3Z',
    book:'M12 5v16 M12 5C8 2 4 3 2 4v16c3-1 7-1 10 1 3-2 7-2 10-1V4c-2-1-6-2-10 1Z',
    chevron:'m9 5 7 7-7 7', down:'m6 9 6 6 6-6', back:'m12 19-7-7 7-7 M5 12h14',
    plus:'M12 5v14 M5 12h14', x:'m6 6 12 12 M18 6 6 18',
    trash:'M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7',
    check:'m5 12 4 4L19 6', shield:'m12 3 9 4v6c0 5-9 9-9 9s-9-4-9-9V7l9-4Z m-4 9 3 3 5-5',
    clock:'M12 8v5l3 2 M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20',
    info:'M12 11v6 M12 7h.01 M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20',
    upload:'M12 16V3 m-5 5 5-5 5 5 M4 15v6h16v-6', image:'M3 3h18v18H3z m0 13 5-5 5 5 3-3 5 5 M8 7h.01',
    mail:'M3 5h18v14H3z m0 0 9 7 9-7', search:'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14 m5 12 6 6',
    mountain:'m2 20 7-14 5 10 3-6 5 10H2 m4-8 3 2 3-2', pin:'M12 22s8-8 8-14A8 8 0 0 0 4 8c0 6 8 14 8 14Z M12 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
    lock:'M5 10h14v11H5z M8 10V6a4 4 0 0 1 8 0v4', arrow:'M4 12h16 m-6-6 6 6-6 6', eye:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6'
  };
  const icon = (name) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.info}"/></svg>`;
  const status = (kind, label) => `<span class="status ${kind}">${e(label)}</span>`;
  const note = (text, kind = '', name = 'info') => `<div class="note ${kind}">${icon(name)}<p>${text}</p></div>`;
  const passports = [{id:'alex',name:'Alex Reyes',initials:'AR',relationship:'Your Passport'}, {id:'mika',name:'Mika Reyes',initials:'MR',relationship:'Managed Passport'}, {id:'sam',name:'Sam Reyes',initials:'SR',relationship:'Managed Passport'}];
  const defaults = () => [
    {id:'70k',code:'70K',label:'70K Ultra Trail',distance:70,price:3500,slots:100,elevation:4200,cutoff:20,blurb:'A demanding route for experienced trail runners.',reserve:true,reservationSlots:20,fee:500,sales:'2026-10-31T23:59',entry:'2026-11-15T23:59',screening:true,requirement:'Complete a trail race of at least 50 km. Upload a finisher certificate or an official results screenshot showing your name and distance.',inclusions:['Race bib','Finisher medal','Event shirt','Post-race meal'],expanded:true},
    {id:'21k',code:'21K',label:'21K Trail Run',distance:21,price:1500,slots:150,elevation:1200,cutoff:7,blurb:'A welcoming introduction to the mountain trails.',reserve:true,reservationSlots:30,fee:300,sales:'2026-10-31T23:59',entry:'2026-11-15T23:59',screening:false,requirement:'',inclusions:['Race bib','Finisher medal','Post-race meal'],expanded:false}
  ];
  const makeState = () => ({categories:defaults(),eventState:'open',notify:true,dirty:false,selected:['alex','mika'],selections:{alex:'70k',mika:'70k',sam:'70k'},proofs:{},explanations:{},uploadErrors:{},uploadBusy:{},intent:'registration',batch:null,unavailable:false,deadlineConflict:false,emailFailed:false,emailTab:'approval',search:'',reviewFilter:'pending',categoryFilter:'all',empty:false});
  let state = makeState();
  let currentScreen = '';
  let embeddedScreen = window.__PROTOTYPE_START__?.screen || null;
  let toastTimer;
  let returnFocus;
  let uploadEpoch = 0;
  let nextCategoryId = 3;
  const cat = id => state.categories.find(c => c.id === id);
  const person = id => passports.find(p => p.id === id);
  const activeMembers = () => state.batch?.members.filter(m => m.status !== 'rejected') || [];
  const pendingMembers = () => activeMembers().filter(m => m.status === 'pending');
  const screenNames = {editor:'Event setup',runner:'Event page',request:'Pre-screening',status:'My request',approvals:'Approvals',emails:'Emails'};
  const initials = id => `<span class="avatar ${id !== 'alex' ? 'alt' : ''}">${person(id).initials}</span>`;

  function sampleProof(id) {
    const canvas = document.createElement('canvas'); canvas.width = 900; canvas.height = 650;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f8f7f0'; ctx.fillRect(0,0,900,650);
    ctx.strokeStyle = '#b9c6b0'; ctx.lineWidth = 2; ctx.strokeRect(28,28,844,594);
    ctx.textAlign = 'center'; ctx.fillStyle = '#53694e'; ctx.font = '18px sans-serif'; ctx.fillText('ILLUSTRATIVE PROOF · NOT A REAL RACE RESULT',450,89);
    ctx.fillStyle = '#1d3829'; ctx.font = '46px Georgia'; ctx.fillText('Finisher certificate',450,191);
    ctx.font = '23px sans-serif'; ctx.fillText('Sample Ridge Trail · 50 km',450,251);
    ctx.font = 'bold 40px sans-serif'; ctx.fillText(person(id).name,450,337);
    ctx.strokeStyle = '#c4d0c1'; ctx.beginPath(); ctx.moveTo(210,372); ctx.lineTo(690,372); ctx.stroke();
    ctx.font = '19px sans-serif'; ctx.fillText('Distance: 50 km     Finish time: 11:42:18',450,421);
    ctx.fillStyle = '#53694e'; ctx.font = '16px sans-serif'; ctx.fillText('For reviewing the pre-screening design only',450,555);
    return canvas.toDataURL('image/png');
  }
  function seedBatch() {
    const c = cat('70k') || state.categories[0];
    state.batch = {id:'PS-0012',intent:state.intent,submittedAt:NOW-3*3600000,payBy:null,paid:false,members:['alex','mika'].map(id => ({id,categoryId:c.id,categoryLabel:c.label,requirement:c.requirement,screeningRequired:c.screening,status:'pending',proof:sampleProof(id),filename:`${id}-50k-certificate.png`,explanation:id === 'alex' ? 'I completed the 50 km course in June. My full name and finish time are on the certificate.' : 'My result is listed under Mika R. on the official results page.',reason:''}))};
  }
  function ensureBatch() { if (!state.batch && !state.empty) seedBatch(); }
  function syncReady() {
    if (!state.batch || state.batch.payBy || pendingMembers().length || !activeMembers().length) return;
    if (state.batch.intent === 'registration' && state.eventState === 'coming_soon') return;
    state.batch.payBy = NOW + 72*3600000;
  }
  function isExpired() { return state.batch?.payBy && state.batch.payBy <= NOW; }
  function toast(message) {
    clearTimeout(toastTimer); const target = $('#toast'); target.textContent = message; target.hidden = false;
    toastTimer = setTimeout(() => { target.hidden = true; }, 5000);
  }
  function modal(content, small = false) {
    returnFocus = document.activeElement;
    $('#dialog').className = small ? 'modal-small' : '';
    $('#dialog-content').innerHTML = content;
    if (!$('#dialog').open) $('#dialog').showModal();
  }
  function closeModal() { $('#dialog').close(); }
  $('#dialog').addEventListener('close', () => { if (returnFocus?.isConnected) returnFocus.focus(); });
  const dialogHeader = (title, subtitle = '') => `<div class="dialog-header"><div><h2 id="dialog-title">${e(title)}</h2>${subtitle ? `<p>${e(subtitle)}</p>` : ''}</div><button class="btn quiet icon-btn" data-action="close" aria-label="Close dialog">${icon('x')}</button></div>`;
  const field = (c,key,label,type='text',hint='',extra='') => `<div class="field"><label for="${c.id}-${key}">${label}</label><input id="${c.id}-${key}" data-category="${c.id}" data-key="${key}" type="${type}" value="${e(c[key])}" ${extra}>${hint ? `<small>${hint}</small>` : ''}</div>`;
  const switchControl = (c,key,label,help,controls) => `<label class="switch-row" for="${c.id}-${key}"><span class="switch-label"><strong>${label}</strong><small>${help}</small></span><span class="switch"><input type="checkbox" id="${c.id}-${key}" data-category="${c.id}" data-key="${key}" ${c[key]?'checked':''} aria-controls="${controls}" aria-expanded="${c[key]}"><span class="switch-track"></span></span></label>`;
  function sidebar(active) {
    const nav = [['Dashboard','grid'],['Events','calendar','editor'],['Registrations','list','approvals'],['Payments','wallet'],['Race kits','box'],['Check-in','qr'],['Team','users'],['Settings','settings'],['Guide','book']];
    return `<aside class="admin-sidebar"><div class="brand"><img src="./assets/logo.png" alt=""><div><strong>Race Pace</strong><small>North Ridge Running</small></div></div><nav class="side-nav" aria-label="Admin">${nav.map(([label,i,to])=>to?`<a href="#${to}" ${active===to?'aria-current="page"':''}>${icon(i)}${label}${label==='Events'?'<span class="count">1</span>':''}</a>`:`<span class="nav-static">${icon(i)}${label}</span>`).join('')}</nav><div class="side-label">PLATFORM</div><div class="side-nav"><span class="nav-static">${icon('users')}Organizations</span><span class="nav-static">${icon('users')}Users</span><span class="nav-static">${icon('wallet')}Commission</span><span class="nav-static">${icon('wallet')}Payouts</span></div><div class="side-footer"><span class="avatar">NR</span><div><strong>North Ridge organizer</strong><small>Organization admin</small></div></div></aside>`;
  }
  const mobileBrand = `<div class="mobile-only mobile-brand"><img src="./assets/logo.png" alt="">Race Pace <span class="muted">/ North Ridge Running</span></div>`;
  function categoryMarkup(c) {
    return `<article class="category-card" id="category-${c.id}"><div class="category-heading"><button class="category-expand" data-action="expand-category" data-id="${c.id}" aria-expanded="${c.expanded}" aria-controls="category-body-${c.id}"><span class="category-code">${e(c.code || 'NEW')}</span><strong>${e(c.label || 'Untitled distance')}</strong><span class="summary">${c.slots} slots${c.screening?' · Pre-screening':''}</span>${icon(c.expanded?'down':'chevron')}</button><button class="btn quiet icon-btn" data-action="remove-category" data-id="${c.id}" aria-label="Remove ${e(c.label||'category')}">${icon('trash')}</button></div><div class="category-body" id="category-body-${c.id}" ${c.expanded?'':'hidden'}>
      <div class="grid two basic-fields">${field(c,'code','Code <span class="required">*</span>','text','', 'required')}${field(c,'label','Label <span class="required">*</span>','text','', 'required')}</div>
      <div class="grid three basic-fields form-gap">${field(c,'distance','Distance (km)','number','','min="0" step="0.01"')}${field(c,'price','Price (₱) <span class="required">*</span>','number','','min="0" step="1" required')}${field(c,'slots','Slots <span class="required">*</span>','number','Total capacity for this category.','min="1" step="1" required')}</div>
      <div class="grid three form-gap">${field(c,'elevation','Elevation gain (m)','number','Optional','min="0"')}${field(c,'cutoff','Cut-off (hours)','number','Optional','min="0" step="0.1"')}${field(c,'blurb','Blurb','text','Optional')}</div>
      <section class="subsection">${switchControl(c,'reserve','Enable reservations','Let runners secure this category before paying the entry fee.',`reservation-${c.id}`)}<div class="disclosure-body" id="reservation-${c.id}" ${c.reserve?'':'hidden'}>
        <div class="grid two">${field(c,'reservationSlots','Reservation slots <span class="required">*</span>','number','Included in the total slots above.','min="1" step="1" required')}${field(c,'fee','Reservation fee (₱) <span class="required">*</span>','number','Separate from the full entry price.','min="1" step="1" required')}</div>
        <div class="allocation" id="allocation-${c.id}"></div><div class="allocation-bar" aria-hidden="true"><span id="allocation-bar-${c.id}"></span></div><p class="error-text" id="allocation-error-${c.id}" hidden></p>
        <div class="grid two form-gap">${field(c,'sales','Reservation sales close <span class="required">*</span>','datetime-local','Unsold reservation slots become general slots.','required')}${field(c,'entry','Full entry payment due <span class="required">*</span>','datetime-local','Unpaid reservations expire after this deadline.','required')}</div>
        <p class="hint form-gap">Times are in Asia/Manila. Reservations can remain available while registration is open.</p><div class="form-gap">${note('The reservation fee is <strong>nonrefundable</strong> and is not deducted from the entry fee. Platform and processing fees are additional.')}</div>
      </div></section>
      <section class="subsection"><div class="subsection-title"><h3>What’s included</h3><button class="btn quiet compact" type="button" data-action="add-inclusion" data-id="${c.id}">${icon('plus')}Add</button></div><p class="hint">Shown only for this category on the runner page.</p><div id="inclusions-${c.id}">${c.inclusions.map((item,index)=>`<div class="inclusion-row">${icon('check')}<input value="${e(item)}" aria-label="${e(c.code)} inclusion ${index+1}" maxlength="140" data-category="${c.id}" data-inclusion="${index}"><button class="btn quiet icon-btn" type="button" data-action="remove-inclusion" data-id="${c.id}" data-index="${index}" aria-label="Remove inclusion ${index+1}">${icon('x')}</button></div>`).join('') || '<p class="hint form-gap">No inclusions yet. Add the first item.</p>'}</div></section>
      <section class="subsection">${switchControl(c,'screening','Require pre-screening','Review each runner’s experience before they can pay.',`screening-${c.id}`)}<div class="disclosure-body" id="screening-${c.id}" ${c.screening?'':'hidden'}><div class="field"><label for="${c.id}-requirement">Requirement for this category <span class="required">*</span></label><textarea id="${c.id}-requirement" data-category="${c.id}" data-key="requirement" rows="3" maxlength="2000" required placeholder="e.g. Complete a trail race of at least 50 km.">${e(c.requirement)}</textarea><small>Runners upload one image up to 10 MB. Their explanation is optional.</small></div><div class="form-gap">${note('<strong>Slots are held during review.</strong> Once the group is approved, the booker has 72 hours to pay. Rejection releases only that runner’s slot.','', 'shield')}</div></div></section>
    </div></article>`;
  }
  function renderEditor() {
    return `${sidebar('editor')}<main class="admin-main" id="main" tabindex="-1">${mobileBrand}<div class="page-header"><div><div class="breadcrumb">Events ${icon('chevron')} North Ridge Trail Run</div><h1>Edit event</h1><p>Manage the details runners see and the categories they can enter.</p></div><div class="actions">${status('approved',state.eventState==='open'?'Registration open':'Coming soon')}<a class="btn secondary" href="#runner">${icon('eye')}Preview event</a></div></div><div class="editor-layout"><nav class="section-nav" aria-label="Event sections"><span><i class="nav-dot"></i>Basics</span><a href="#coming-soon-context" data-scroll="coming-soon-context"><i class="nav-dot"></i>Coming soon</a><span><i class="nav-dot"></i>Location</span><span><i class="nav-dot"></i>Course</span><a class="active" href="#category-section" data-scroll="category-section"><i class="nav-dot"></i>Categories <b>${state.categories.length}</b></a><span><i class="nav-dot"></i>Images</span><span><i class="nav-dot"></i>Schedule</span><span><i class="nav-dot"></i>Add-ons</span></nav><div class="editor-content"><section class="panel context-panel" id="coming-soon-context"><div class="panel-heading"><h2>Coming soon</h2><small>Publish before registration opens</small></div><div class="panel-body"><label class="switch-row" for="notify-enabled"><span class="switch-label"><strong>Notify me</strong><small>Email followers when registration opens.</small></span><span class="switch"><input id="notify-enabled" type="checkbox" ${state.notify?'checked':''}><span class="switch-track"></span></span></label><p class="hint form-gap">Reservation options are now set within each category.</p></div></section><section class="panel" id="category-section"><div class="panel-heading"><h2>Categories</h2><small>Configure each distance and its entry options</small><button class="btn secondary compact push" data-action="add-category">${icon('plus')}Add distance</button></div><div class="panel-body"><div class="capacity-summary" aria-live="polite"><strong id="total-capacity"></strong><small id="capacity-split"></small></div>${state.categories.map(categoryMarkup).join('')}<div id="editor-error" class="error-text" role="alert" hidden></div></div></section><section class="panel"><div class="unmodified"><h2>Images, schedule & add-ons</h2><small>Existing sections unchanged</small></div></section></div></div><footer class="save-bar"><span class="save-state ${state.dirty?'unsaved':''}" id="save-state">${state.dirty?'Unsaved changes':'All changes saved'}</span><div class="actions"><button class="btn secondary" data-action="discard">Cancel</button><button class="btn" data-action="save-event">Save event</button></div></footer></main>`;
  }
  function updateCapacity() {
    const total = state.categories.reduce((n,c)=>n+(Number(c.slots)||0),0);
    const reserved = state.categories.reduce((n,c)=>n+(c.reserve ? Number(c.reservationSlots)||0 : 0),0);
    if ($('#total-capacity')) $('#total-capacity').textContent = `${total} total slots across ${state.categories.length} categories`;
    if ($('#capacity-split')) $('#capacity-split').textContent = `Calculated from category slots · ${reserved} allocated for reservations`;
    for (const c of state.categories) {
      if (!$(`#allocation-${c.id}`)) continue;
      const remaining = Number(c.slots)-Number(c.reservationSlots);
      $(`#allocation-${c.id}`).innerHTML = `<strong>${e(c.slots)} total</strong><span>−</span><span>${e(c.reservationSlots)} reservation</span><span>=</span><strong>${Math.max(0,remaining)} general slots</strong>`;
      $(`#allocation-bar-${c.id}`).style.width = `${Math.min(100,Math.max(0,Number(c.reservationSlots)/Math.max(1,Number(c.slots))*100))}%`;
      const error = $(`#allocation-error-${c.id}`); error.hidden = remaining >= 0;
      error.textContent = 'Reservation slots cannot exceed this category’s total slots.';
      $(`#${c.id}-reservationSlots`).setAttribute('aria-invalid', String(remaining<0));
    }
  }
  function markDirty() {state.dirty=true; if($('#save-state')){$('#save-state').textContent='Unsaved changes';$('#save-state').classList.add('unsaved');}}
  function runnerNav() {return `<div class="runner-nav"><a class="runner-brand" href="#runner"><img src="./assets/logo.png" alt="">Race Pace</a><div class="links"><a href="#runner">Events</a><span>Organizers</span><a href="#status">My entries</a></div><div class="runner-profile"><span>Alex Reyes</span><span class="avatar">AR</span></div></div>`;}
  function renderRunner() {
    return `${runnerNav()}<main id="main" tabindex="-1"><section class="runner-hero ${state.eventState==='coming_soon'?'coming-soon':''}"><img src="./assets/ridgeline-runners.webp" alt="Illustrative trail runners on a mountain ridge"><div class="runner-hero-inner">${status('approved',state.eventState==='open'?'Registration open':'Coming soon')}<h1>North Ridge<br>Trail Run</h1><div class="event-facts"><span>${icon('pin')}Bukidnon, Philippines</span><span>${icon('calendar')}${state.eventState==='open'?'29 November 2026':'Date to be announced'}</span><span>${icon('mountain')}Trail run</span></div></div></section><div class="runner-main"><div class="runner-intro"><p>A day on the mountain trails, from a first trail half-marathon to a demanding ultra. Choose the distance that fits your experience.</p><div class="organizer"><span class="avatar">NR</span><div><small>Organized by</small><br><strong>North Ridge Running</strong></div></div></div>${state.unavailable?note('This preview shows a sold-out category. Existing held places are still protected.','warning'):''}<div class="event-section-title"><div><h2>Choose your distance</h2><p>Each category has its own inclusions and entry requirements.</p></div><a class="btn quiet" href="#status">View my request ${icon('arrow')}</a></div>${state.categories.map(c=>`<section class="distance-row"><div><h3>${e(c.label)}</h3><div class="facts">${e(c.distance)} km · ${e(c.elevation||'—')} m elevation · ${e(c.cutoff||'—')} hr cut-off</div><p>${e(c.blurb)}</p><div class="tags">${c.screening?status('pending','Pre-screening required'):status('approved','No pre-screening')}${c.reserve?status('', c.screening?'Reservation after approval':'Reservations available'):''}</div>${c.screening?`<p>${e(c.requirement)}</p>`:''}<details><summary>What’s included</summary><ul>${c.inclusions.filter(Boolean).map(x=>`<li>${e(x)}</li>`).join('') || '<li>Inclusions will be announced.</li>'}</ul></details></div><div class="distance-actions"><div class="price">${money(c.price)}<small>Entry fee · platform and processing fees additional</small></div>${state.unavailable?'<button class="btn secondary" disabled>No slots available</button>':c.screening?`<button class="btn primary-cta" data-action="start-request" data-id="${c.id}">Request pre-screening ${icon('arrow')}</button>`:state.eventState==='open'?`<button class="btn" data-action="direct-entry" data-id="${c.id}">Register ${icon('arrow')}</button>`:'<button class="btn secondary" disabled>Registration opens later</button>'}${c.reserve&&!state.unavailable?`<button class="btn secondary" data-action="start-reservation" data-id="${c.id}">${c.screening?'Request reservation review':`Reserve for ${money(c.fee)}`}</button><p class="hint">${c.screening?`Reservation fee: ${money(c.fee)}, payable only after pre-screening approval.<br>`:''}Reservations close ${e(localDate(c.sales))} PHT.<br>Full entry payment due ${e(localDate(c.entry))} PHT.</p>`:''}</div></section>`).join('')}<hr class="subtle-rule">${note('A reservation fee is separate, nonrefundable, and <strong>not deducted from the entry price</strong>. Pre-screening holds your place while the organizer reviews your proof.')} ${state.eventState==='coming_soon'&&state.notify?'<div class="event-section-title"><div><h2>Know when registration opens</h2><p>Receive one email when full registration becomes available.</p></div><button class="btn secondary" data-action="notify">Notify me</button></div>':''}</div></main>`;
  }
  function uploadMarkup(id) {
    const proof=state.proofs[id]; const busy=state.uploadBusy[id]; const p=person(id);
    return `<div class="upload ${proof?'has-image':''}" data-drop="${id}">${proof?`<img class="upload-thumb" src="${e(proof.url)}" alt="Proof for ${p.name}"><div class="upload-content"><strong>${e(proof.name)}</strong><small>${proof.sample?'Sample proof · illustrative only':`${(proof.size/1000000).toFixed(2)} MB · ready to submit`}</small><div><label for="proof-${id}">Replace image</label></div></div><button class="btn quiet icon-btn" data-action="remove-proof" data-id="${id}" aria-label="Remove proof for ${p.name}">${icon('x')}</button>`:`${icon('upload')}<label for="proof-${id}">${busy?'Preparing image…':'Choose proof image'}</label><small>or drag and drop it here</small><small>JPEG, PNG or WebP · up to 10 MB</small>`}<input type="file" id="proof-${id}" accept="image/jpeg,image/png,image/webp" data-upload="${id}" aria-label="Proof image for ${p.name}" ${busy?'disabled':''} aria-describedby="proof-hint-${id}"></div>${busy?'<progress class="progress form-gap" aria-label="Preparing image"></progress>':''}<div class="upload-actions"><span class="hint" id="proof-hint-${id}">Required for ${p.name}.</span><button class="text-button sample-link" data-action="sample-proof" data-id="${id}">Use sample proof</button></div>${state.uploadErrors[id]?`<p class="error-text" role="alert">${e(state.uploadErrors[id])}</p>`:''}`;
  }
  function participantForm(id) {
    const p=person(id),c=cat(state.selections[id])||state.categories[0];
    return `<section class="participant-form"><div class="participant-title">${initials(id)}<div><h3>${p.name}</h3><small>${p.relationship}</small></div></div><div class="field"><label for="selection-${id}">Category</label><select id="selection-${id}" data-participant-category="${id}">${state.categories.map(option=>`<option value="${option.id}" ${option.id===c.id?'selected':''}>${e(option.label)} · ${money(option.price)}</option>`).join('')}</select></div>${c.screening?`<div class="requirement"><strong>Pre-screening requirement</strong>${e(c.requirement)}</div><div id="upload-area-${id}">${uploadMarkup(id)}</div><div class="field form-gap"><label for="explanation-${id}">Anything else the organizer should know? <span class="optional">Optional</span></label><textarea id="explanation-${id}" rows="3" maxlength="2000" data-explanation="${id}" placeholder="Add context about your previous race or proof.">${e(state.explanations[id]||'')}</textarea><small>This explanation is visible only to you and the organizer’s reviewers.</small></div>`:`<div class="form-gap">${note('No pre-screening needed for this category. Submitting this group request holds this runner’s slot too. They wait with the group until the required reviews are approved; no payment is due during review.','success','check')}</div>`}</section>`;
  }
  function renderRequest() {
    return `${runnerNav()}<div class="runner-workspace"><main class="flow-wrap" id="main" tabindex="-1"><div class="flow-heading"><a class="breadcrumb" href="#runner">${icon('back')}North Ridge Trail Run</a><h1>Request pre-screening</h1><p>Choose a category for each runner. Submit proof only where required. All selected slots are held together, with no payment during review.</p></div><div class="flow-columns"><section class="flow-panel"><h2>Who’s joining?</h2><p>Choose your own or managed Race Passports. You can select different categories for each person.</p>${passports.map(p=>`<label class="passport-option" for="passport-${p.id}"><input id="passport-${p.id}" type="checkbox" data-passport="${p.id}" ${state.selected.includes(p.id)?'checked':''}>${initials(p.id)}<span><strong>${p.name}</strong><small>${p.relationship}</small></span>${state.selected.includes(p.id)?'<span class="selected-category">Selected</span>':''}</label>`).join('')}<div class="form-gap">${note('<strong>No payment to submit.</strong> Submission holds a slot for every selected Passport. If any runner needs pre-screening, the whole group waits for approval before paying.','','shield')}</div><div id="participants">${state.selected.map(participantForm).join('')}</div><div class="flow-submit"><p class="error-text" role="alert" id="submit-error" hidden></p><button class="btn" data-action="submit-request" ${!state.selected.length?'disabled':''}>Submit & hold ${state.selected.length} ${state.selected.length===1?'slot':'slots'} ${icon('arrow')}</button><p>No payment now. Every selected slot is held after successful submission, including categories without pre-screening. Uploading alone does not hold a slot.</p></div></section><aside class="flow-aside"><div class="flow-panel"><h2>What happens next</h2><ol class="steps"><li><div><strong>Submit one group request</strong><span>Each runner chooses a category. Only categories requiring pre-screening need proof.</span></div></li><li><div><strong>Everyone’s slot is held</strong><span>This includes runners in categories without pre-screening. No one pays while a required review is pending.</span></div></li><li><div><strong>Pay together after approval</strong><span>Once all required reviews are approved and payment is available, we email you. Your group then has 72 hours to pay.</span></div></li></ol>${note('If one participant is rejected, only their slot is released. They can choose another available category.','','shield')}<div class="privacy">${icon('lock')}<p>Proof stays private. Only the booker and authorized reviewers can view it.</p></div></div></aside></div></main></div>`;
  }
  function renderStatus() {
    ensureBatch(); if(!state.batch)return `${runnerNav()}<main class="flow-wrap" id="main" tabindex="-1"><div class="empty">${icon('list')}<h1>No pre-screening requests</h1><p>Select a category to start a request.</p><a class="btn" href="#runner">Explore categories</a></div></main>`;
    const b=state.batch,active=activeMembers(),pending=pendingMembers(),approved=active.filter(m=>m.status==='approved'&&m.screeningRequired!==false),expired=isExpired(),waitingOpen=!pending.length&&!b.payBy&&active.length;
    const heading=b.paid?(b.intent==='reservation'?'Your reservation is secured':'You’re registered'):expired?'Your payment window expired':!active.length?'Your slots have been released':pending.length?(approved.length?'Part of your group is approved':'Your slots are held'):waitingOpen?'Approved · waiting for registration':'Your group is ready to pay';
    const description=b.paid?(b.intent==='reservation'?'Your screening approval carries forward. Complete full entry payment by the category deadline.':'This is a simulated payment confirmation for design review.'):expired?'The approved slots have been released. Start a new request to check availability.':!active.length?'You can choose a category that does not require pre-screening.':pending.length?'Every remaining runner’s slot is held, including categories without pre-screening. No payment is due until all required reviews are approved.':waitingOpen?'Your slots stay held. Your 72-hour window starts when registration opens.':'Your approved categories are already selected. Complete one payment within 72 hours to keep these slots.';
    return `${runnerNav()}<div class="runner-workspace"><main class="flow-wrap" id="main" tabindex="-1"><div class="flow-heading"><a class="breadcrumb" href="#runner">${icon('back')}North Ridge Trail Run</a><h1>My pre-screening request</h1><p>${b.id} · Submitted ${formatDate(b.submittedAt)} PHT</p></div><div class="flow-columns"><section class="flow-panel"><div class="request-banner"><span class="banner-icon">${icon(b.paid?'check':expired?'clock':pending.length?'shield':'check')}</span><div><h2>${heading}</h2><p>${description}</p></div></div>${b.members.map(m=>`<article class="request-member">${initials(m.id)}<div class="member-info"><h3>${person(m.id).name}</h3><p>${e(m.categoryLabel)} · ${person(m.id).relationship}</p><p>${m.status==='rejected'?'Slot released':expired?'Payment window expired · slot released':b.paid?'Payment confirmed':m.status==='approved'?(m.screeningRequired===false?'No review needed · slot held with group':'Approved · slot held'):'Awaiting review · slot held'}</p>${m.status==='rejected'?`<p class="decision-reason">${e(m.reason)}</p><button class="text-button" data-action="alternative" data-id="${m.id}">Choose another category ${icon('arrow')}</button>`:''}</div>${status(m.status,m.status==='pending'?'Pending review':m.status==='approved'?(m.screeningRequired===false?'No review needed':'Approved'):'Not approved')}</article>`).join('')}<div class="request-note">${note('A rejection does not affect other participants. Your group’s payment window never resets when an email is resent.','','info')}</div>${state.emailFailed?`<div class="form-gap">${note('Your approval email could not be delivered. Your payment link and deadline are available here. The organizer can resend the email.','warning','mail')}</div>`:''}<div class="actions form-gap"><a class="btn secondary" href="#approvals">Preview organizer review</a>${!b.paid&&!expired&&active.length?'<button class="btn quiet" data-action="cancel-request">Cancel request</button>':''}</div></section><aside class="flow-aside"><div class="flow-panel"><h2>${b.paid?'Payment summary':'Your next step'}</h2>${b.paid?`<div class="deadline">${b.intent==='reservation'?'Reservation paid':'Entry paid'}</div><p class="hint">Demonstration only · no charge was made.</p>`:b.payBy&&!expired?`<p class="hint form-gap">Complete payment by</p><div class="deadline">${new Intl.DateTimeFormat('en-PH',{day:'numeric',month:'short',timeZone:'Asia/Manila'}).format(b.payBy)}<small>9:00 AM PHT · ${Math.ceil((b.payBy-NOW)/3600000)} hours remaining</small></div>`:`<p class="hint form-gap">${expired?'A new availability check is required.':pending.length?`${pending.length} participant${pending.length>1?'s':''} still awaiting review. No payment is due yet.`:waitingOpen?'We’ll email you when payment becomes available.':'No payment is due.'}</p>`}${pending.length?`<div class="form-gap">${active.map(m=>`<div class="receipt-line"><span>${person(m.id).name}<br><small>${e(m.categoryLabel)}</small></span><strong>Slot held</strong></div>`).join('')}</div><div class="receipt-line receipt-total"><span>Due now</span><strong>${money(0)}</strong></div><p class="hint">Every listed slot stays held while the required reviews are pending. You will pay together after approval.</p>`:`<div class="form-gap">${active.map(m=>`<div class="receipt-line"><span>${person(m.id).name}<br><small>${e(m.categoryLabel)}</small></span><strong>${money(b.intent==='reservation'?cat(m.categoryId).fee:cat(m.categoryId).price)}</strong></div>`).join('')}</div><div class="receipt-line receipt-total"><span>${b.intent==='reservation'?'Reservation fees':'Entry fees'}</span><strong>${money(active.reduce((n,m)=>n+(b.intent==='reservation'?cat(m.categoryId).fee:cat(m.categoryId).price),0))}</strong></div><p class="hint">Platform and processing fees are shown before payment.</p>`}${!b.paid?`<button class="btn full form-gap" data-action="pay-batch" ${pending.length||waitingOpen||expired||!active.length?'disabled':''}>${pending.length?'Waiting for group approval':waitingOpen?'Registration opens later':expired?'Payment window expired':b.intent==='reservation'?'Pay reservation fees':'Continue to payment'} ${icon('arrow')}</button>`:''}${b.intent==='reservation'&&!pending.length?'<p class="hint form-gap">The reservation fee is nonrefundable and does not reduce your entry fee.</p>':''}<p class="request-meta">Approved categories stay selected. Changing category requires a fresh availability check.</p></div></aside></div></main></div>`;
  }
  function filteredMembers() {return (state.batch?.members||[]).filter(m=>(state.reviewFilter==='all'||m.status===state.reviewFilter)&&(state.categoryFilter==='all'||m.categoryId===state.categoryFilter)&&`${person(m.id).name} ${m.categoryLabel}`.toLowerCase().includes(state.search.toLowerCase()));}
  function reviewRows() {return filteredMembers().map(m=>`<tr><td><div class="person">${initials(m.id)}<div><strong>${person(m.id).name}</strong><small>${person(m.id).relationship==='Your Passport'?'Booker’s Passport':'Managed by Alex Reyes'}</small></div></div></td><td>${e(m.categoryLabel)}</td><td><strong>${formatDate(state.batch.submittedAt).split(',')[0]}</strong><small>Submitted together · ${state.batch.id}</small></td><td>${status(m.status,m.status==='pending'?'Pending review':m.status==='approved'?(m.screeningRequired===false?'No review needed':'Approved'):'Not approved')}</td><td>${m.status==='rejected'||isExpired()?'Released':state.batch.paid?'Converted':'Held'}</td><td><button class="btn secondary compact" data-action="review" data-id="${m.id}">${m.status==='pending'?'Review proof':'View decision'} ${icon('chevron')}</button></td></tr>`).join('');}
  function renderApprovals() {
    ensureBatch(); const pending=pendingMembers().length;
    return `${sidebar('approvals')}<main class="admin-main" id="main" tabindex="-1">${mobileBrand}<div class="review-page"><div class="page-header"><div><div class="breadcrumb">North Ridge Running ${icon('chevron')}Registrations</div><h1>Registrations</h1><p>Manage race entries and review runners before they pay.</p></div><div class="field"><label class="sr-only" for="approval-event">Event</label><select id="approval-event" disabled><option>North Ridge Trail Run</option></select></div></div><div class="registration-context">${icon('list')}<div><strong>Registered runners</strong><p>The existing registrations table remains above this new section.</p></div></div><div class="review-heading"><h2>Pre-screening approvals</h2>${status('pending',`${pending} pending`)}</div><p class="muted small form-gap">Review each Passport’s proof. Their slot stays held until you approve or reject the request.</p>${state.deadlineConflict?`<div class="form-gap">${note('The payment deadline leaves less than 72 hours. Extend the category deadline before approving.','warning','clock')}</div>`:''}${state.emailFailed?`<div class="note warning form-gap">${icon('mail')}<p>Approval email failed. The group can still pay from My request. Resending keeps the same deadline.</p><button class="btn secondary compact" data-action="resend-email">Resend email</button></div>`:''}<div class="table-toolbar"><div class="search">${icon('search')}<input aria-label="Search pre-screening requests" placeholder="Search runner or category" id="review-search" value="${e(state.search)}"></div><select class="control" id="review-category" aria-label="Filter by category"><option value="all">All categories</option>${state.categories.map(c=>`<option value="${c.id}" ${state.categoryFilter===c.id?'selected':''}>${e(c.label)}</option>`).join('')}</select><select class="control" id="review-filter" aria-label="Filter by review status">${[['pending','Pending review'],['approved','Approved'],['rejected','Not approved'],['all','All statuses']].map(([value,label])=>`<option value="${value}" ${state.reviewFilter===value?'selected':''}>${label}</option>`).join('')}</select></div><div class="table-shell"><table><caption class="sr-only">Pre-screening applications for North Ridge Trail Run</caption><thead><tr><th scope="col">Runner</th><th scope="col">Category</th><th scope="col">Submitted</th><th scope="col">Status</th><th scope="col">Slot</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead><tbody id="review-rows">${reviewRows()}</tbody></table><div class="empty" id="review-empty" ${filteredMembers().length?'hidden':''}>${icon('check')}<h2>No requests to show</h2><p>${state.empty?'New pre-screening requests will appear here.':'Try another filter, or view all statuses.'}</p></div><div class="table-foot"><span id="review-count">${filteredMembers().length} requests</span><span>Private proof · organization reviewers only</span></div></div><div class="form-gap">${note('<strong>Groups pay together.</strong> An approval email is sent when every remaining participant is approved. Rejected participants are removed from that payment and their slots are released.','','users')}</div></div></main>`;
  }
  function updateReviewRows(){ $('#review-rows').innerHTML=reviewRows(); $('#review-empty').hidden=filteredMembers().length>0; $('#review-count').textContent=`${filteredMembers().length} requests`; }
  function openReview(id) {
    const m=state.batch.members.find(x=>x.id===id),p=person(id);
    if(m.screeningRequired===false){modal(`${dialogHeader('No pre-screening required',`${p.name} · ${m.categoryLabel}`)}<div class="dialog-body"><p>This category does not require proof or an organizer decision. This runner’s slot is held with the group while the required reviews are pending.</p>${note('Group payment stays locked until every required review is approved.','','shield')}</div><div class="dialog-footer"><button class="btn secondary" data-action="close">Close</button></div>`,true);return;}

    modal(`${dialogHeader('Review pre-screening',`${p.name} · ${m.categoryLabel}`)}<div class="dialog-body"><div class="review-grid"><div><div class="proof-stage" id="proof-stage"><img src="${e(m.proof)}" alt="Submitted proof for ${p.name}" data-action="zoom-proof" tabindex="0" role="button" aria-label="Zoom proof for ${p.name}"><small>${e(m.filename)} · private proof</small><button class="btn secondary compact" data-action="zoom-proof">${icon('eye')}Zoom proof</button></div></div><div class="review-details"><dl><dt>Runner</dt><dd>${p.name}</dd><dt>Passport</dt><dd>${p.relationship==='Your Passport'?'Booker’s own Passport':'Managed by Alex Reyes'}</dd><dt>Category</dt><dd>${e(m.categoryLabel)}</dd><dt>Status</dt><dd>${status(m.status,m.status==='pending'?'Pending review':m.status==='approved'?(m.screeningRequired===false?'No review needed':'Approved'):'Not approved')}</dd><dt>Slot</dt><dd>${m.status==='rejected'?'Released':'Held for this participant'}</dd></dl><h3>Requirement when submitted</h3><blockquote>${e(m.requirement)}</blockquote><h3>Runner’s explanation</h3><blockquote>${e(m.explanation||'No explanation provided.')}</blockquote>${m.status==='rejected'?note(e(m.reason),'error'):m.status==='approved'?note('Approved by North Ridge organizer. The remaining group must be approved before payment opens.','success','check'):note('Review this participant independently. Rejecting this request does not release other runners’ slots.','','shield')}${state.deadlineConflict&&m.status==='pending'?`<div class="form-gap">${note('Extend the category deadline to allow a full 72-hour payment window before approving.','warning','clock')}<button class="text-button" data-action="fix-deadline">Edit category deadline</button></div>`:''}</div></div></div><div class="dialog-footer">${m.status==='pending'?`<button class="btn secondary" data-action="reject-form" data-id="${id}">Reject request</button><button class="btn" data-action="approve" data-id="${id}" ${state.deadlineConflict?'disabled':''}>${icon('check')}Approve ${p.name.split(' ')[0]}</button>`:'<button class="btn secondary" data-action="close">Close</button>'}</div>`);
  }
  function renderEmails() {
    ensureBatch(); const rejected=state.batch?.members.find(m=>m.status==='rejected') || {id:'mika',categoryLabel:'70K Ultra Trail',reason:'The submitted proof does not show a completed race of at least 50 km.'};
    const approval=state.emailTab==='approval'; const reminder=state.emailTab==='reminder';
    const subject=approval?'Your group is approved — complete payment within 72 hours':reminder?'Your approved places are waiting for payment':'An update on your pre-screening request';
    const members=activeMembers().length?activeMembers():[{id:'alex',categoryLabel:'70K Ultra Trail'}];
    return `${runnerNav()}<div class="runner-workspace"><main class="email-shell" id="main" tabindex="-1"><h1>Runner emails</h1><p class="muted small form-gap">Preview messages sent to the booker. No email is sent from this prototype.</p><div class="email-controls" role="group" aria-label="Email type">${[['approval','Group approved'],['rejection','Not approved'],['reminder','Payment reminder']].map(([value,label])=>`<button class="btn secondary" data-action="email-tab" data-id="${value}" aria-pressed="${state.emailTab===value}">${label}</button>`).join('')}</div><article class="email-envelope"><header><strong>To</strong><span>Alex Reyes &lt;alex@example.com&gt;</span><strong>From</strong><span>Race Pace · North Ridge Running</span><strong>Subject</strong><span>${subject}</span></header><div class="email-content"><div class="email-logo"><img src="./assets/logo.png" alt="">Race Pace</div><h2>${approval?'Your group is approved.':reminder?'Your places are still held.':'An update on your request.'}</h2><p>Hi Alex,</p>${approval||reminder?`<p>${approval?'North Ridge Running has approved the remaining participants in your group for':'You can still complete payment for your approved group at'} <strong>North Ridge Trail Run</strong>.</p><div class="email-members">${members.map(m=>`<div class="receipt-line"><span><strong>${person(m.id).name}</strong><br><small>${person(m.id).relationship}</small></span><span>${e(m.categoryLabel)}</span></div>`).join('')}</div><p>Complete ${state.batch?.intent==='reservation'?'your reservation payment':'your entry payment'} by <strong>${formatDate(state.batch?.payBy||NOW+72*3600000)} PHT</strong>. Your approved categories are already selected.</p><a class="btn" href="#status">View request & continue to payment ${icon('arrow')}</a><p class="small muted">If payment is not completed in time, your held slots will be released. Resending this email does not extend the deadline.</p>`:`<p>The organizer could not approve <strong>${person(rejected.id).name}</strong> for <strong>${e(rejected.categoryLabel)}</strong>.</p>${note(e(rejected.reason),'warning')}<p>Only this participant’s slot has been released. Other participants in your request keep their slots while their applications are reviewed.</p><p>${person(rejected.id).name.split(' ')[0]} can choose another available category that does not require pre-screening. A new availability check applies.</p><a class="btn" href="#runner">View other categories ${icon('arrow')}</a>`}<div class="email-footer">North Ridge Running · Race Pace<br>Your request and proof are private. Sign in to view your request.<br><br>Illustrative email for design review. No message has been sent.</div></div></article></main></div>`;
  }
  function render(scroll=false) {
    const screen=embeddedScreen || location.hash.slice(1).split('?')[0] || 'editor'; currentScreen=screenNames[screen]?screen:'editor';
    $('#screen-nav').innerHTML=Object.entries(screenNames).map(([key,label])=>`<a href="#${key}" ${currentScreen===key?'aria-current="page"':''}>${label}</a>`).join('');
    const screens={editor:renderEditor,runner:renderRunner,request:renderRequest,status:renderStatus,approvals:renderApprovals,emails:renderEmails};
    $('#app').innerHTML=screens[currentScreen]();
    if(currentScreen==='editor') {updateCapacity(); syncEditorDisabled();}
    document.title=`${screenNames[currentScreen]} · Race Pace design preview`;
    if(scroll){window.scrollTo({top:0,behavior:'instant'});$('#main').focus({preventScroll:true});}
  }
  function syncEditorDisabled(){for(const c of state.categories){$$('input,textarea,select',$(`#reservation-${c.id}`)).forEach(input=>input.disabled=!c.reserve);$$('textarea',$(`#screening-${c.id}`)).forEach(input=>input.disabled=!c.screening);}}
  function go(screen){if(embeddedScreen!==null){embeddedScreen=screen;render(true);return;}if(location.hash===`#${screen}`)render(true);else location.hash=screen;}
  function setScenario(name) {
    state.unavailable=name==='unavailable';state.deadlineConflict=name==='deadline';state.emailFailed=name==='email-failed';state.empty=name==='empty';state.reviewFilter='pending';
    if(state.empty){state.batch=null;render();return;}
    seedBatch();
    if(['mixed','mixed-managed'].includes(name)){
      const exempt=state.batch.members[name==='mixed'?1:0],c=cat('21k')||state.categories.find(c=>!c.screening);
      if(c)Object.assign(exempt,{categoryId:c.id,categoryLabel:c.label,requirement:'',screeningRequired:false,status:'approved',proof:'',filename:'',explanation:''});
    }
    if(name==='partial')state.batch.members[0].status='approved';
    if(['ready','expired','email-failed'].includes(name)){state.batch.members.forEach(m=>m.status='approved');state.eventState='open';$('#event-state').value='open';syncReady();}
    if(name==='rejected'){state.batch.members[0].status='approved';Object.assign(state.batch.members[1],{status:'rejected',reason:'The proof does not show a completed race of at least 50 km.'});syncReady();state.reviewFilter='all';}
    if(name==='expired')state.batch.payBy=NOW-3600000;
    if(name==='deadline'){state.categories[0].entry='2026-10-02T09:00';state.categories[0].sales='2026-10-01T23:59';}
    render();
  }
  async function takeFile(id,file) {
    if(!file)return;
    let error='';
    if(file.size>MAX_FILE)error='This image is over 10 MB. Choose an image of 10 MB or less.';
    else if(!['image/jpeg','image/png','image/webp'].includes(file.type))error='Choose a JPEG, PNG, or WebP image. Other file types are not accepted.';
    else if(!file.size)error='This file is empty. Choose another image.';
    if(error){state.uploadErrors[id]=error;$(`#upload-area-${id}`).innerHTML=uploadMarkup(id);return;}
    const epoch=uploadEpoch;state.uploadErrors[id]='';state.uploadBusy[id]=true;$(`#upload-area-${id}`).innerHTML=uploadMarkup(id);
    try {
      const url=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('read'));reader.readAsDataURL(file);});
      await new Promise((resolve,reject)=>{const image=new Image();image.onload=resolve;image.onerror=reject;image.src=url;});
      if(epoch!==uploadEpoch)return;
      state.proofs[id]={url,name:file.name,size:file.size,sample:false};
    } catch {if(epoch===uploadEpoch)state.uploadErrors[id]='This image could not be read. Choose a valid JPEG, PNG, or WebP image and try again.';}
    if(epoch!==uploadEpoch)return;
    state.uploadBusy[id]=false;
    if($(`#upload-area-${id}`)){$(`#upload-area-${id}`).innerHTML=uploadMarkup(id);$(`#proof-${id}`).focus();}
  }
  function submitRequest(){
    let error='';const selectedCategories=state.selected.map(id=>cat(state.selections[id]));
    if(!state.selected.length)error='Select at least one Passport.';
    else if(state.unavailable)error='These slots are no longer available. Your request was not submitted. Choose another category.';
    else if(state.selected.some(id=>state.uploadBusy[id]))error='Wait for your image to finish preparing.';
    else if(state.selected.some(id=>cat(state.selections[id]).screening&&!state.proofs[id]))error='Add a proof image for each participant in a category requiring pre-screening.';
    else if(state.intent==='reservation'&&selectedCategories.some(c=>!c.reserve))error='Reservations are not enabled for every selected category. Choose entry payment or another category.';
    else if(state.intent==='reservation'&&selectedCategories.some(c=>Date.parse(`${c.sales}:00+08:00`)<=NOW))error='Reservation sales have closed for a selected category. Choose full entry payment instead.';
    if(error){$('#submit-error').hidden=false;$('#submit-error').textContent=error;$('#submit-error').scrollIntoView({block:'center'});return;}
    const submit=$('[data-action="submit-request"]');submit.disabled=true;submit.textContent='Securing your slots…';
    setTimeout(()=>{
      state.empty=false;
      state.batch={id:'PS-0013',intent:state.intent,submittedAt:NOW,payBy:null,paid:false,members:state.selected.map(id=>{const c=cat(state.selections[id]);return {id,categoryId:c.id,categoryLabel:c.label,requirement:c.requirement,screeningRequired:c.screening,status:c.screening?'pending':'approved',proof:state.proofs[id]?.url||'',filename:state.proofs[id]?.name||'',explanation:state.explanations[id]||'',reason:''};})};
      syncReady();go('status');toast(`${state.selected.length} slots held. Request submitted in this preview.`);
    },450);
  }
  function openPayment(categoryId, intent='registration', participantId='alex') {
    if(categoryId&&cat(categoryId).screening){state.intent=intent;state.selected=[participantId];state.selections[participantId]=categoryId;go('request');return;}
    if(!categoryId&&(!state.batch?.payBy||pendingMembers().length||isExpired())){toast('Payment is locked until every remaining participant is approved.');return;}
    const members=categoryId?[{id:participantId,categoryId,categoryLabel:cat(categoryId).label}]:activeMembers();
    const actualIntent=categoryId?intent:state.batch.intent;
    const total=members.reduce((sum,m)=>sum+(actualIntent==='reservation'?cat(m.categoryId).fee:cat(m.categoryId).price),0);
    modal(`${dialogHeader(actualIntent==='reservation'?'Review your reservation':'Review your entry','Payment preview · no charge will be made')}<div class="dialog-body"><p>${categoryId?'Your selected category does not require pre-screening.':'Your approved Passports and categories are already selected.'}</p>${members.map(m=>`<div class="receipt-line"><span><strong>${person(m.id).name}</strong><br><small>${e(m.categoryLabel)}</small></span><strong>${money(actualIntent==='reservation'?cat(m.categoryId).fee:cat(m.categoryId).price)}</strong></div>`).join('')}<div class="receipt-line receipt-total"><span>${actualIntent==='reservation'?'Reservation fees':'Entry fees'}</span><strong>${money(total)}</strong></div>${note('Platform and processing fees will be shown in the real checkout. This prototype does not connect to a payment provider.')} ${actualIntent==='reservation'?'<p class="hint form-gap">The reservation fee is separate and nonrefundable. It is not deducted from the full entry price.</p>':''}<div class="field form-gap"><label for="preview-payment-method">Payment method</label><select id="preview-payment-method"><option>QR Ph (illustrative)</option></select></div></div><div class="dialog-footer"><button class="btn secondary" data-action="close">Back</button><button class="btn" data-action="simulate-payment" data-id="${categoryId||''}">Simulate successful payment</button></div>`,true);
  }
  document.addEventListener('input',event=>{
    const target=event.target;
    if(target.id==='reject-reason')target.setCustomValidity('');
    if(target.dataset.category){const c=cat(target.dataset.category);if(target.dataset.inclusion!==undefined)c.inclusions[Number(target.dataset.inclusion)]=target.value;else if(target.dataset.key&&target.type!=='checkbox')c[target.dataset.key]=target.type==='number'?(target.value===''?'':Number(target.value)):target.value;markDirty();updateCapacity();}
    if(target.dataset.explanation)state.explanations[target.dataset.explanation]=target.value;
    if(target.id==='review-search'){state.search=target.value;updateReviewRows();}
  });
  document.addEventListener('change',event=>{
    const target=event.target;
    if(target.dataset.category&&target.type==='checkbox'){const c=cat(target.dataset.category);c[target.dataset.key]=target.checked;target.setAttribute('aria-expanded',String(target.checked));$(`#${target.getAttribute('aria-controls')}`).hidden=!target.checked;markDirty();syncEditorDisabled();updateCapacity();}
    if(target.id==='notify-enabled'){state.notify=target.checked;markDirty();}
    if(target.dataset.passport){const id=target.dataset.passport;state.selected=target.checked?[...state.selected,id]:state.selected.filter(x=>x!==id);render();$(`#passport-${id}`).focus();}
    if(target.dataset.participantCategory){state.selections[target.dataset.participantCategory]=target.value;render();$(`#selection-${target.dataset.participantCategory}`).focus();}

    if(target.dataset.upload)takeFile(target.dataset.upload,target.files[0]);
    if(target.id==='review-filter'){state.reviewFilter=target.value;updateReviewRows();}
    if(target.id==='review-category'){state.categoryFilter=target.value;updateReviewRows();}
    if(target.id==='event-state'){state.eventState=target.value;syncReady();render();}
    if(target.id==='scenario')setScenario(target.value);
  });
  document.addEventListener('click',event=>{
    if(event.target.closest('.skip-link')){event.preventDefault();$('#main').focus();return;}
    const anchor=event.target.closest('a[href]');
    if(embeddedScreen!==null&&anchor&&screenNames[anchor.getAttribute('href').slice(1)]){event.preventDefault();go(anchor.getAttribute('href').slice(1));return;}
    const scroll=event.target.closest('[data-scroll]');if(scroll){event.preventDefault();$(`#${scroll.dataset.scroll}`).scrollIntoView({block:'start',behavior:'instant'});return;}
    const target=event.target.closest('[data-action]');if(!target)return;
    const {action,id}=target.dataset;
    if(action==='close'){closeModal();return;}
    if(action==='expand-category'){const c=cat(id);c.expanded=!c.expanded;render();$(`[data-action="expand-category"][data-id="${id}"]`).focus();}
    if(action==='add-inclusion'){cat(id).inclusions.push('');markDirty();render();$(`#inclusions-${id} .inclusion-row:last-child input`).focus();}
    if(action==='remove-inclusion'){cat(id).inclusions.splice(Number(target.dataset.index),1);markDirty();render();$(`[data-action="add-inclusion"][data-id="${id}"]`).focus();}
    if(action==='add-category'){const newId=`category${nextCategoryId++}`;state.categories.push({...defaults()[1],id:newId,code:'',label:'',slots:50,reserve:false,screening:false,expanded:true,inclusions:[]});markDirty();render();$(`#${newId}-code`).focus();}
    if(action==='remove-category'){if(state.batch?.members.some(m=>m.categoryId===id&&m.status!=='rejected')){toast('This category has participant holds. Resolve them before removing it.');return;}if(state.categories.length<=1){toast('Keep at least one category in this sample event.');return;}modal(`${dialogHeader('Remove category?')}<div class="dialog-body"><p>Remove ${e(cat(id).label)} from this local preview? No real event will change.</p></div><div class="dialog-footer"><button class="btn secondary" data-action="close">Keep category</button><button class="btn danger" data-action="confirm-remove-category" data-id="${id}">Remove category</button></div>`,true);}
    if(action==='confirm-remove-category'){state.categories=state.categories.filter(c=>c.id!==id);for(const pid of passports.map(p=>p.id))if(state.selections[pid]===id)state.selections[pid]=state.categories[0].id;markDirty();closeModal();render();toast('Category removed from this preview.');}
    if(action==='discard'){state.categories=defaults();state.dirty=false;render();toast('Sample category settings restored.');}
    if(action==='save-event'){
      let message='';
      for(const c of state.categories){if(!c.code.trim()||!c.label.trim()||!Number.isInteger(c.slots)||c.slots<1||c.price<0)message='Set a code, label, valid price, and positive whole-number slots for each category.';if(c.reserve&&(!Number.isInteger(c.reservationSlots)||c.reservationSlots<1||c.reservationSlots>c.slots||c.fee<=0))message='Reservation slots must be between 1 and the category total. Enter a positive reservation fee.';if(c.reserve&&(!c.sales||!c.entry||c.sales>=c.entry))message='Full entry payment must be due after reservation sales close.';if(c.screening&&!c.requirement.trim())message='Describe the pre-screening requirement for each enabled category.';}
      if(message){$('#editor-error').textContent=message;$('#editor-error').hidden=false;$('#editor-error').scrollIntoView({block:'center'});return;}
      state.dirty=false;state.deadlineConflict=state.categories.some(c=>c.reserve&&Date.parse(`${c.entry}:00+08:00`)<NOW+72*3600000);render();toast('Event settings saved in this preview.');
    }
    if(action==='start-request'||action==='start-reservation'){state.intent=action==='start-reservation'?'reservation':'registration';state.selected=['alex','mika'];state.selections={alex:id,mika:id,sam:id};if(action==='start-reservation'&&!cat(id).screening)openPayment(id,'reservation');else go('request');}
    if(action==='direct-entry')openPayment(id);
    if(action==='notify')toast('Notification preference saved in this preview. No email will be sent.');
    if(action==='sample-proof'){state.proofs[id]={url:sampleProof(id),name:`${id}-50k-certificate.png`,size:64000,sample:true};state.uploadErrors[id]='';$(`#upload-area-${id}`).innerHTML=uploadMarkup(id);$(`[data-action="sample-proof"][data-id="${id}"]`).focus();toast(`Sample proof added for ${person(id).name}.`);}
    if(action==='remove-proof'){delete state.proofs[id];$(`#upload-area-${id}`).innerHTML=uploadMarkup(id);$(`#proof-${id}`).focus();}
    if(action==='submit-request')submitRequest();
    if(action==='review')openReview(id);
    if(action==='zoom-proof'){const proof=$('#proof-stage');proof.classList.toggle('zoomed');proof.querySelector('img').setAttribute('aria-pressed',String(proof.classList.contains('zoomed')));}
    if(action==='approve'){
      if(state.deadlineConflict)return;
      const m=state.batch.members.find(x=>x.id===id);if(m.status!=='pending')return;m.status='approved';syncReady();closeModal();render();
      toast(pendingMembers().length?`${person(id).name} approved. Group payment waits for the remaining review.`:'Group approved. The approval email is ready in the email preview.');
    }
    if(action==='reject-form'){modal(`${dialogHeader(`Reject ${person(id).name}’s request?`)}<form id="reject-form" data-id="${id}"><div class="dialog-body"><p>Only this runner’s slot will be released. Other group members keep their holds.</p><div class="field"><label for="reject-reason">Reason for rejection <span class="required">*</span></label><textarea id="reject-reason" required maxlength="2000" rows="4" placeholder="Explain what was missing from the proof." autofocus></textarea><small>This reason appears in the runner’s request and notification email.</small></div></div><div class="dialog-footer"><button type="button" class="btn secondary" data-action="review" data-id="${id}">Back to proof</button><button type="submit" class="btn danger">Reject & release slot</button></div></form>`,true);$('#reject-reason').focus();}
    if(action==='fix-deadline'){closeModal();go('editor');toast('Extend the full entry payment deadline, then save the category.');}
    if(action==='pay-batch'){if(!pendingMembers().length&&state.batch.payBy&&!isExpired())openPayment();}
    if(action==='simulate-payment'){if(!id)state.batch.paid=true;closeModal();render();toast('Payment simulated. No money was charged.');}
    if(action==='alternative'){const choices=state.categories.filter(c=>!c.screening);modal(`${dialogHeader(`Another category for ${person(id).name}`,'The previous rejected slot has already been released.')}<div class="dialog-body"><p>Choose a category without pre-screening. A new availability check applies. The original group’s payment deadline stays unchanged.</p>${choices.map(c=>`<div class="payment-preview"><h3>${e(c.label)}</h3><div class="price">${money(c.price)}</div><p class="hint">${c.inclusions.map(e).join(' · ')}</p><button class="btn form-gap" data-action="alternative-entry" data-id="${id}" data-category-id="${c.id}" ${state.unavailable||state.eventState!=='open'?'disabled':''}>${state.unavailable?'No slots available':state.eventState!=='open'?'Registration opens later':'Continue with this category'}</button></div>`).join('')||'<p>No categories without pre-screening are available.</p>'}</div><div class="dialog-footer"><button class="btn secondary" data-action="close">Close</button></div>`,true);}
    if(action==='alternative-entry')openPayment(target.dataset.categoryId,'registration',id);
    if(action==='cancel-request'){modal(`${dialogHeader('Cancel this request?')}<div class="dialog-body"><p>This releases all remaining slots in this unpaid request. You can submit again, subject to availability.</p></div><div class="dialog-footer"><button class="btn secondary" data-action="close">Keep request</button><button class="btn danger" data-action="confirm-cancel">Cancel & release slots</button></div>`,true);}
    if(action==='confirm-cancel'){state.batch=null;state.empty=true;closeModal();render();toast('Request cancelled. Its held slots were released in the preview.');}
    if(action==='resend-email'){state.emailFailed=false;render();toast('Email resend simulated. The payment deadline is unchanged.');}
    if(action==='email-tab'){state.emailTab=id;render();$(`[data-action="email-tab"][data-id="${id}"]`).focus();}
  });
  document.addEventListener('submit',event=>{if(event.target.id!=='reject-form')return;event.preventDefault();const reason=$('#reject-reason').value.trim();if(!reason){$('#reject-reason').setCustomValidity('Enter a reason for rejection.');$('#reject-reason').reportValidity();return;}const id=event.target.dataset.id,m=state.batch.members.find(x=>x.id===id);m.status='rejected';m.reason=reason;syncReady();closeModal();render();toast(`${person(id).name} was not approved. Only their slot has been released.`);});
  document.addEventListener('keydown',event=>{
    if(event.key==='Tab'&&$('#dialog').open){
      const stops=$$('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',$('#dialog')).filter(node=>node.getClientRects().length);
      if(stops.length){event.preventDefault();const index=stops.indexOf(document.activeElement);stops[(index+(event.shiftKey?-1:1)+stops.length)%stops.length].focus();}return;
    }
    if(event.target.matches('[data-action="zoom-proof"]')&&event.target.tagName==='IMG'&&['Enter',' '].includes(event.key)){event.preventDefault();event.target.click();}});
  for(const name of ['dragover','dragleave','drop'])document.addEventListener(name,event=>{const zone=event.target.closest('[data-drop]');if(!zone)return;event.preventDefault();zone.classList.toggle('drag',name==='dragover');if(name==='drop')takeFile(zone.dataset.drop,event.dataTransfer.files[0]);});
  $('#test-upload').addEventListener('click',async()=>{
    const kind=$('#upload-case').value;
    if(currentScreen!=='request'){toast('Open Pre-screening to try an upload validation case.');return;}
    const id=state.selected.find(pid=>cat(state.selections[pid]).screening);
    if(!id){toast('Select a Passport in a category requiring proof first.');return;}
    const data=atob(sampleProof(id).split(',')[1]);
    const size=kind==='exact'?MAX_FILE:kind==='oversize'?MAX_FILE+1:32;
    const bytes=new Uint8Array(size);
    if(kind==='exact'||kind==='oversize')for(let i=0;i<data.length;i++)bytes[i]=data.charCodeAt(i);
    const file=new File([bytes],`preview-${kind}.${kind==='type'?'txt':'png'}`,{type:kind==='type'?'text/plain':'image/png'});
    await takeFile(id,file);
    $(`#upload-area-${id}`).scrollIntoView({block:'center'});
  });
  $('#demo-tools-toggle').addEventListener('click',()=>{const box=$('#demo-tools');box.hidden=!box.hidden;$('#demo-tools-toggle').setAttribute('aria-expanded',String(!box.hidden));});
  $('#reset-demo').addEventListener('click',()=>{uploadEpoch++;state=makeState();$('#scenario').value='pending';$('#event-state').value='open';render();toast('Preview reset. All sample changes cleared.');});
  window.addEventListener('hashchange',()=>render(true));
  const initial=window.__PROTOTYPE_START__;
  if(initial?.screen)embeddedScreen=initial.screen;
  if(initial?.scenario){$('#scenario').value=initial.scenario;setScenario(initial.scenario);}else render();
})();
