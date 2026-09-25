const $ = (id) => document.getElementById(id);
const peso = (cents) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(cents / 100);
const centsOf = (value) => Math.round(Number(value || 0) * 100);
const deadlineLabel = () => {
  const value = $("reservation-deadline").value;
  if (!value) return "Deadline to be set";
  const date = new Date(`${value}:00+08:00`);
  if (Number.isNaN(date.getTime())) return "Deadline to be set";
  return `${new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", dateStyle: "long", timeStyle: "short" }).format(date)} PHT`;
};

// Illustrative local rate card for the prototype. A live checkout must read
// current offered rates and calculate the authoritative charge on the server.
const rateCard = {
  gcash: { percentBps: 250, fixedCents: 0 },
  maya: { percentBps: 150, fixedCents: 0 },
  card: { percentBps: 350, fixedCents: 1500 },
  qrph: { percentBps: 150, fixedCents: 0 },
};

function commissionCents(baseCents) {
  const value = Math.max(0, Number($("commission-value").value || 0));
  if ($("commission-type").value === "fixed") return Math.min(centsOf(value), baseCents);
  return Math.min(Math.round(baseCents * value / 100), baseCents);
}

function updateFees() {
  const base = Math.max(0, centsOf($("reservation-fee").value));
  const platform = commissionCents(base);
  const method = rateCard[$("payment-method").value];
  const total = Math.ceil(((base + platform + method.fixedCents) * 10000) / (10000 - method.percentBps));
  const processor = total - base - platform;
  $("reserve-base").textContent = peso(base);
  $("fee-base").textContent = peso(base);
  $("fee-platform").textContent = peso(platform);
  $("fee-processor").textContent = peso(processor);
  $("fee-total").textContent = peso(total);
  $("commission-example").textContent = peso(commissionCents(50000));
  $("aside-reserve").textContent = `Reserve a place · ${peso(base)}`;
}

function syncPreview() {
  const name = $("event-name").value.trim() || "Untitled event";
  const discipline = $("event-discipline").value;
  const comingSoon = $("coming-soon-toggle").checked;
  const reserve = $("reserve-toggle").checked;
  const notify = $("notify-toggle").checked;

  $("runner-title").textContent = name;
  $("aside-title").textContent = name;
  $("runner-discipline").textContent = discipline;
  $("fact-discipline").textContent = discipline;
  $("aside-discipline").textContent = discipline;
  $("runner-description").textContent = $("event-description").value.trim() || "The organizer will share the event description soon.";
  $("runner-content").hidden = !comingSoon;
  $("unpublished-state").hidden = comingSoon;
  $("preview-options").hidden = !comingSoon;
  $("reserve-options").hidden = !reserve;
  $("reserve-panel").hidden = !reserve;
  $("notify-panel").hidden = !notify;
  $("aside-reserve").hidden = !reserve;
  $("aside-notify").hidden = !notify;
  $("aside-reserve").parentElement.hidden = !reserve && !notify;
  $("runner-deadline").textContent = deadlineLabel();
  updateFees();
}

function selectView(name, focus = false) {
  for (const tab of document.querySelectorAll(".view-tab")) {
    const selected = tab.dataset.view === name;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    if (selected && focus) tab.focus();
  }
  for (const view of document.querySelectorAll(".view")) view.hidden = view.id !== `view-${name}`;
  history.replaceState(null, "", `#${name}`);
  window.scrollTo({ top: 0, behavior: "instant" });
}

for (const tab of document.querySelectorAll(".view-tab")) {
  tab.addEventListener("click", () => selectView(tab.dataset.view));
  tab.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const tabs = [...document.querySelectorAll(".view-tab")];
    const index = tabs.indexOf(tab);
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    selectView(tabs[next].dataset.view, true);
  });
}
for (const button of document.querySelectorAll("[data-open-view]")) button.addEventListener("click", () => selectView(button.dataset.openView));

for (const id of ["event-name", "event-discipline", "event-description", "coming-soon-toggle", "reserve-toggle", "notify-toggle", "reservation-fee", "reservation-deadline", "payment-method", "commission-type", "commission-value"]) {
  $(id).addEventListener("input", syncPreview);
  $(id).addEventListener("change", syncPreview);
}
$("commission-type").addEventListener("change", () => {
  $("commission-unit").textContent = $("commission-type").value === "fixed" ? "₱" : "%";
  $("commission-value").step = $("commission-type").value === "fixed" ? "0.01" : "0.1";
  updateFees();
});

let uploadedImageUrl;
$("event-image").addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (!file || !file.type.startsWith("image/")) return;
  if (uploadedImageUrl) URL.revokeObjectURL(uploadedImageUrl);
  uploadedImageUrl = URL.createObjectURL(file);
  for (const id of ["hero-photo", "editor-cover", "aside-cover"]) $(id).src = uploadedImageUrl;
  $("hero-photo").alt = `Cover image for ${$("event-name").value.trim() || "the event"}`;
});

$("notify-form").addEventListener("submit", (event) => {
  event.preventDefault();
  $("notify-feedback").textContent = `Prototype only: ${$("notify-email").value} would receive one email when registration opens.`;
});

$("reserve-button").addEventListener("click", () => {
  let feedback = $("reservation-feedback");
  if (!feedback) {
    feedback = document.createElement("p");
    feedback.id = "reservation-feedback";
    feedback.className = "reserve-small";
    feedback.setAttribute("role", "status");
    $("reserve-button").after(feedback);
  }
  feedback.textContent = `Prototype only: a live checkout would now confirm the ${$("fee-total").textContent} total before payment.`;
});

$("save-preview").addEventListener("click", () => {
  const missing = [];
  if (!$("event-name").value.trim()) missing.push("event name");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test($("event-link").value.trim())) missing.push("valid public link");
  if (!$("event-description").value.trim()) missing.push("description");
  if (!$("event-image").files.length && !$("editor-cover").src) missing.push("cover image");
  if ($("coming-soon-toggle").checked && $("reserve-toggle").checked) {
    if (centsOf($("reservation-fee").value) <= 0) missing.push("reservation fee");
    if (Number($("total-event-slots").value) < 1) missing.push("total event slots");
    if (!$("reservation-deadline").value) missing.push("reservation payment deadline");
  }
  $("admin-feedback").textContent = missing.length ? `Add ${missing.join(", ")} to save this preview.` : "Prototype only: the coming soon preview is ready to review. Nothing was saved.";
});

$("save-commission").addEventListener("click", () => {
  $("commission-feedback").textContent = "Prototype only: the example commission updates the runner fee preview. No terms were saved.";
});

const initialView = location.hash.slice(1);
selectView(["runner", "editor", "commission"].includes(initialView) ? initialView : "runner");
syncPreview();
