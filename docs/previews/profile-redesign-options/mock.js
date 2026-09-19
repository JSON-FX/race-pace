const ICONS = {
  user: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/></svg>',
  ticket: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5A1.5 1.5 0 0 1 5.5 6h13A1.5 1.5 0 0 1 20 7.5v2a2.5 2.5 0 0 0 0 5v2a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 16.5v-2a2.5 2.5 0 0 0 0-5v-2Z"/><path d="M12 8.5v1M12 14.5v1"/></svg>',
  mountain: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 19 6.2-10 3 4.5 2.5-4L21 19H3Z"/><path d="m7.7 11.4 1.5 1.1 1.3-.9"/></svg>',
  camera: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8.5h3l1.2-2h7.6l1.2 2h3v10H4v-10Z"/><circle cx="12" cy="13.5" r="3.2"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4 10-10"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M14 7l5 5-5 5"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 10 4 4 4-4"/></svg>',
  shield: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 5 6v5c0 4.6 2.8 8.4 7 10 4.2-1.6 7-5.4 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/></svg>',
  map: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 6 5-2 8 3 5-2v13l-5 2-8-3-5 2V6Z"/><path d="M8 4v13M16 7v13"/></svg>',
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 4.2-1 10.5-10.5a2.1 2.1 0 0 0-3-3L5.2 16 4 20Z"/><path d="m14.5 6.5 3 3"/></svg>',
  logout: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 5H5v14h5M13 8l4 4-4 4M17 12H9"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v15H5V5ZM8 3v4M16 3v4M5 9h14"/></svg>',
  phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 4H5.8A1.8 1.8 0 0 0 4 5.8C4 13.6 10.4 20 18.2 20a1.8 1.8 0 0 0 1.8-1.8v-1.7l-4.1-1.4-1 2.1a13.2 13.2 0 0 1-8.1-8.1l2.1-1L7.5 4Z"/></svg>',
};

const THEME_LABELS = {
  summit: ["01", "Summit Bento", "Modular, bright, composed"],
  ledger: ["02", "Trail Ledger", "Editorial, precise, tactile"],
  beacon: ["03", "Night Beacon", "Dark, technical, energized"],
  bib: ["04", "Bib Board", "Bold, playful, memorable"],
  contour: ["05", "Contour Flow", "Organic, calm, human"],
};

const currentTheme = document.body.dataset.theme || "summit";
const currentLabel = THEME_LABELS[currentTheme] || THEME_LABELS.summit;

function field(label, value, type = "text", extra = "") {
  return `<label class="field"><span>${label}</span><input type="${type}" value="${value}" ${extra}></label>`;
}

function selectField(label, value, values) {
  return `<label class="field"><span>${label}</span><select>${values.map((item) => `<option${item === value ? " selected" : ""}>${item}</option>`).join("")}</select></label>`;
}

function bookingCard(name, event, category, status, meta, action) {
  return `<article class="booking-card" data-status="${status.toLowerCase()}">
    <div class="booking-date"><strong>${meta.day}</strong><span>${meta.month}</span></div>
    <div class="booking-main">
      <div class="booking-topline"><span class="status status-${status.toLowerCase()}">${status === "Paid" ? ICONS.check : ""}${status}</span><span class="booking-ref">${meta.ref}</span></div>
      <p class="booking-person">${name}</p>
      <h3>${event}</h3>
      <p class="booking-category">${ICONS.mountain}${category}</p>
    </div>
    <button class="booking-action js-feedback" type="button" data-message="${action === "Continue payment" ? "Opening the saved checkout…" : "Opening the participant race pass…"}">${action}${ICONS.arrow}</button>
  </article>`;
}

const app = document.querySelector("#mock-app");
app.innerHTML = `
  <a class="skip-link" href="#main-content">Skip to profile content</a>
  <div class="concept-strip">
    <div class="concept-current"><span>${currentLabel[0]}</span><strong>${currentLabel[1]}</strong><small>${currentLabel[2]}</small></div>
    <nav aria-label="Mockup options">
      ${Object.entries(THEME_LABELS).map(([key, label]) => `<a ${key === currentTheme ? 'aria-current="page"' : ""} href="option-${label[0]}-${key === "summit" ? "summit-bento" : key === "ledger" ? "trail-ledger" : key === "beacon" ? "night-beacon" : key === "bib" ? "bib-board" : "contour-flow"}.html"><span>${label[0]}</span>${label[1]}</a>`).join("")}
      <a class="back-gallery" href="index.html">Overview</a>
    </nav>
  </div>

  <div class="app-shell">
    <header class="site-header">
      <a class="brand" href="#" aria-label="Race Pace home"><img src="../../../apps/site/public/topnav-logo.png" alt="Race Pace" width="82" height="44"><span>RACE PACE</span></a>
      <nav class="desktop-primary" aria-label="Main navigation"><a href="#">Home</a><a href="#">Races</a><a href="#">My Races</a><a class="active" href="#" aria-current="page">Profile</a></nav>
      <button class="quiet-action js-feedback" type="button" data-message="This mock keeps the existing sign-out action.">${ICONS.logout}<span>Sign out</span></button>
    </header>

    <main id="main-content">
      <div class="account-tabs" role="tablist" aria-label="Account pages">
        <button id="profile-tab" class="account-tab active" type="button" role="tab" aria-selected="true" aria-controls="profile-view" data-view="profile">${ICONS.user}<span>Race Passport</span></button>
        <button id="bookings-tab" class="account-tab" type="button" role="tab" aria-selected="false" aria-controls="bookings-view" data-view="bookings">${ICONS.ticket}<span>Bookings I manage</span><b>3</b></button>
      </div>

      <section id="profile-view" class="view active" role="tabpanel" aria-labelledby="profile-tab">
        <div class="profile-hero">
          <div class="cover-art" role="img" aria-label="Layered green mountains representing a runner cover photo">
            <img src="../../../apps/site/public/landing/trail-ridge-hero.webp" alt="Trail ridge under a bright sky">
            ${currentTheme === "summit" ? "" : '<div class="cover-lines" aria-hidden="true"></div>'}
            <button class="photo-button cover-button js-feedback" type="button" data-message="Cover photo picker opened.">${ICONS.camera}<span>Change cover</span></button>
          </div>
          <div class="runner-lockup">
            <button class="avatar js-feedback" type="button" aria-label="Change profile photo" data-message="Profile photo picker opened."><span>JC</span>${ICONS.camera}</button>
            <div><p class="eyebrow">Runner profile</p><h1>Jamie Cruz</h1><p class="runner-meta">Davao City · Trail runner since 2024</p></div>
          </div>
          <dl class="career-stats"><div><dt>Races</dt><dd>04</dd></div><div><dt>Distance</dt><dd>112<small>km</small></dd></div><div><dt>Passport</dt><dd class="complete-stat">${ICONS.check}<span>Ready</span></dd></div></dl>
        </div>

        <div class="profile-layout">
          <aside class="passport-rail">
            <div class="rail-heading"><p class="eyebrow">Saved runners</p><h2>Race Passports</h2></div>
            <div class="passport-list" role="listbox" aria-label="Choose a Passport">
              <button class="passport-person selected" type="button" role="option" aria-selected="true" data-passport="Jamie Cruz"><span class="mini-avatar">JC</span><span><strong>My Passport</strong><small>Jamie Cruz · Complete</small></span>${ICONS.chevron}</button>
              <button class="passport-person" type="button" role="option" aria-selected="false" data-passport="Mika Cruz"><span class="mini-avatar alt">MC</span><span><strong>Mika Cruz</strong><small>Managed · Needs address</small></span>${ICONS.chevron}</button>
            </div>
            <button class="secondary-button add-passport" type="button">${ICONS.plus}<span>Add someone else</span></button>
            <p class="rail-note">You can help another runner with permission. Their Passport does not create a login or reserve a slot.</p>
            <div class="privacy-note">${ICONS.shield}<span><strong>Private by design</strong>Your details are only shared with events you enter.</span></div>
          </aside>

          <form class="passport-form" novalidate>
            <div class="form-heading"><div><p class="eyebrow">Editing</p><h2 data-editing-name>Jamie’s Passport</h2><p>Keep race-day details current. Required fields are marked.</p></div><span class="completion-ring" aria-label="Passport 100 percent complete"><b>100</b><small>%</small></span></div>

            <details class="form-section" open><summary><span class="section-icon">${ICONS.user}</span><span><strong>Personal details</strong><small>Name, birthday, and gender</small></span>${ICONS.chevron}</summary><div class="field-grid">
              ${field("First name *", "Jamie")}${field("Last name *", "Cruz")}${field("Team name", "Davao Ridge Runners")}${field("Date of birth *", "1994-08-18", "date")}${selectField("Gender *", "Female", ["Select gender", "Female", "Male", "Non-binary", "Prefer not to say"])}
              <div class="read-only"><span>Account email</span><strong>jamie@example.com</strong><small>Managed from account settings</small></div>
            </div></details>

            <details class="form-section" open><summary><span class="section-icon">${ICONS.phone}</span><span><strong>Contact and safety</strong><small>Reachable contacts for event day</small></span>${ICONS.chevron}</summary><div class="field-grid">
              ${field("Contact number *", "+63 917 555 0142", "tel", 'class="phone-input" inputmode="tel" maxlength="17"')}${field("Emergency contact *", "Paolo Cruz")}${field("Emergency number *", "+63 918 555 0188", "tel", 'class="phone-input" inputmode="tel" maxlength="17"')}${selectField("Relationship *", "Brother", ["Select relationship", "Mother", "Father", "Parent", "Wife", "Husband", "Spouse", "Partner", "Sister", "Brother", "Sibling", "Daughter", "Son", "Child", "Grandmother", "Grandfather", "Grandparent", "Granddaughter", "Grandson", "Grandchild", "Aunt", "Uncle", "Cousin", "Niece", "Nephew", "Other relative", "Guardian", "Caregiver", "Friend", "Coach", "Team manager", "Colleague", "Neighbor", "Other"])}${selectField("Shirt size *", "M", ["XS", "S", "M", "L", "XL", "2XL"])}${selectField("Blood type", "O+", ["Not provided", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"])}
            </div></details>

            <details class="form-section"><summary><span class="section-icon">${ICONS.map}</span><span><strong>Shipping address *</strong><small>Required for your Race Passport</small></span><span class="section-state">Saved</span>${ICONS.chevron}</summary><div class="field-grid shipping-grid">
              ${selectField("Region *", "Region XI (Davao Region)", ["Select region", "Region XI (Davao Region)"])}${selectField("Province *", "Davao del Sur", ["Select province", "Davao del Sur"])}${selectField("City or municipality *", "Davao City", ["Select city", "Davao City"])}${selectField("Barangay *", "Matina Crossing", ["Select barangay", "Matina Crossing"])}${field("ZIP code *", "8000", "text", 'inputmode="numeric"')}${field("House, building, and street *", "18 Ridge View, Acacia Street")}
              <button class="text-button js-feedback" type="button" data-message="Shipping address cleared in the mock.">Clear shipping address</button>
            </div></details>

            <div class="form-actions"><p><span class="save-dot"></span>All changes are ready to save</p><button class="primary-button save-passport" type="submit">Save Passport${ICONS.arrow}</button></div>
          </form>
        </div>
      </section>

      <section id="bookings-view" class="view" role="tabpanel" aria-labelledby="bookings-tab" hidden>
        <div class="bookings-header"><div><p class="eyebrow">Participant support</p><h1>Bookings I manage</h1><p>Registrations you made for other runners. Each paid participant keeps a separate race pass.</p></div><button class="primary-button go-passports" type="button">${ICONS.user}<span>Manage Passports</span></button></div>
        <div class="booking-summary"><div><span>03</span><p>Managed bookings</p></div><div><span>02</span><p>Race passes ready</p></div><div><span>01</span><p>Payment to finish</p></div></div>
        <div class="booking-toolbar"><div class="filter-pills" aria-label="Filter bookings"><button class="active" type="button" data-filter="all">All <span>3</span></button><button type="button" data-filter="paid">Paid <span>2</span></button><button type="button" data-filter="pending">Pending <span>1</span></button></div><p>Newest first</p></div>
        <div class="booking-list">
          ${bookingCard("Mika Cruz", "Mindanao Mountain Marathon", "25K · Open Trail", "Paid", { day: "22", month: "NOV", ref: "RP-7A42" }, "View race pass")}
          ${bookingCard("Paolo Santos", "Mt. Apo Sky Race", "50K · Ultra", "Pending", { day: "07", month: "DEC", ref: "RP-8D19" }, "Continue payment")}
          ${bookingCard("Lena Ramos", "Davao River Run", "10K · Road", "Paid", { day: "18", month: "JAN", ref: "RP-2F61" }, "View race pass")}
        </div>
        <div class="bookings-help">${ICONS.shield}<div><strong>One runner, one registration</strong><p>Participant-owned records prevent duplicate entries, even when a helper books for someone else.</p></div></div>
      </section>
    </main>

    <nav class="mobile-tabs" aria-label="Primary"><a href="#">${ICONS.mountain}<span>Home</span></a><a href="#">${ICONS.map}<span>Races</span></a><a href="#">${ICONS.ticket}<span>My Races</span></a><a class="active" href="#">${ICONS.user}<span>Profile</span></a></nav>
  </div>
  <div class="toast" role="status" aria-live="polite"></div>
`;

const views = [...document.querySelectorAll(".view")];
const tabs = [...document.querySelectorAll(".account-tab")];

function showView(name) {
  views.forEach((view) => {
    const active = view.id === `${name}-view`;
    view.classList.toggle("active", active);
    view.hidden = !active;
  });
  tabs.forEach((tab) => {
    const active = tab.dataset.view === name;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  document.querySelector("#main-content").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}

tabs.forEach((tab) => tab.addEventListener("click", () => showView(tab.dataset.view)));
document.querySelector(".go-passports").addEventListener("click", () => showView("profile"));

let toastTimer;
function notify(message) {
  const toast = document.querySelector(".toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
}

document.querySelectorAll(".js-feedback").forEach((button) => button.addEventListener("click", () => notify(button.dataset.message)));
function formatPhilippinePhone(value) {
  let digits = value.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("63")) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = digits.slice(1);
  digits = digits.slice(0, 10);
  return `+63${digits ? ` ${[digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 10)].filter(Boolean).join(" ")}` : ""}`;
}
document.querySelectorAll(".phone-input").forEach((input) => input.addEventListener("input", () => { input.value = formatPhilippinePhone(input.value); }));
document.querySelector(".passport-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const button = document.querySelector(".save-passport");
  button.disabled = true;
  button.firstChild.textContent = "Saving…";
  setTimeout(() => {
    button.disabled = false;
    button.firstChild.textContent = "Save Passport";
    notify("Passport saved.");
  }, 650);
});

document.querySelectorAll(".passport-person").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll(".passport-person").forEach((item) => {
    const selected = item === button;
    item.classList.toggle("selected", selected);
    item.setAttribute("aria-selected", String(selected));
  });
  document.querySelector("[data-editing-name]").textContent = `${button.dataset.passport.split(" ")[0]}’s Passport`;
  notify(`${button.dataset.passport} selected.`);
}));

document.querySelector(".add-passport").addEventListener("click", () => notify("New participant Passport flow opened."));

document.querySelectorAll("[data-filter]").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll("[data-filter]").forEach((item) => item.classList.toggle("active", item === button));
  document.querySelectorAll(".booking-card").forEach((card) => {
    card.hidden = button.dataset.filter !== "all" && card.dataset.status !== button.dataset.filter;
  });
}));

document.querySelectorAll("a[href='#']").forEach((link) => link.addEventListener("click", (event) => event.preventDefault()));
