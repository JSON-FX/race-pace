const options = ["journal", "ledger", "signal", "dossier"];

function showOption(name, focus = false) {
  let activeTab;
  for (const tab of document.querySelectorAll("[data-option]")) {
    const selected = tab.dataset.option === name;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    if (selected) activeTab = tab;
    if (selected && focus) tab.focus();
  }
  for (const section of document.querySelectorAll(".option")) section.hidden = section.id !== `option-${name}`;
  activeTab?.scrollIntoView({ block: "nearest", inline: "center", behavior: "instant" });
  history.replaceState(null, "", `#${name}`);
  window.scrollTo({ top: 0, behavior: "instant" });
}

for (const tab of document.querySelectorAll("[data-option]")) {
  tab.addEventListener("click", () => showOption(tab.dataset.option));
  tab.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = options.indexOf(tab.dataset.option);
    const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + options.length) % options.length;
    showOption(options[next], true);
  });
}

const rateCard = { gcash: [250, 0], maya: [150, 0], card: [350, 1500], qrph: [150, 0] };
const peso = (cents) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(cents / 100);
function updateFee(id, method) {
  const [percentBps, fixedCents] = rateCard[method];
  const total = Math.ceil(((50000 + 1500 + fixedCents) * 10000) / (10000 - percentBps));
  document.getElementById(`${id}-processor`).textContent = peso(total - 51500);
  document.getElementById(`${id}-total`).textContent = peso(total);
}
document.getElementById("ledger-method").addEventListener("change", (event) => updateFee("ledger", event.target.value));
for (const radio of document.querySelectorAll('input[name="dossier-method"]')) {
  radio.addEventListener("change", (event) => updateFee("dossier", event.target.value));
}

const galleryImages = [
  { src: "ridgeline-runners.webp", alt: "Trail runners crossing a misty mountain ridge", label: "ridge photo" },
  { src: "forest-runners.webp", alt: "Trail runners climbing a shaded forest path", label: "forest photo" },
];
const galleryOpen = document.getElementById("dossier-gallery-open");
const galleryDialog = document.getElementById("dossier-gallery-dialog");
let galleryIndex = 0;

function selectGalleryImage(index) {
  galleryIndex = (index + galleryImages.length) % galleryImages.length;
  const image = galleryImages[galleryIndex];
  for (const id of ["dossier-gallery-image", "dossier-gallery-dialog-image"]) {
    const element = document.getElementById(id);
    element.src = image.src;
    element.alt = image.alt;
  }
  const count = `${String(galleryIndex + 1).padStart(2, "0")} / ${String(galleryImages.length).padStart(2, "0")}`;
  document.getElementById("dossier-gallery-count").textContent = count;
  document.getElementById("dossier-gallery-dialog-count").textContent = count;
  galleryOpen.setAttribute("aria-label", `Open ${image.label} full screen`);
  for (const button of document.querySelectorAll("[data-gallery-index]")) {
    button.setAttribute("aria-pressed", String(Number(button.dataset.galleryIndex) === galleryIndex));
  }
}

for (const button of document.querySelectorAll("[data-gallery-index]")) {
  button.addEventListener("click", () => selectGalleryImage(Number(button.dataset.galleryIndex)));
}
for (const button of document.querySelectorAll("[data-gallery-step]")) {
  button.addEventListener("click", () => selectGalleryImage(galleryIndex + Number(button.dataset.galleryStep)));
}
galleryOpen.addEventListener("click", () => galleryDialog.showModal());
document.getElementById("dossier-gallery-close").addEventListener("click", () => galleryDialog.close());
document.getElementById("dossier-gallery-full-image").addEventListener("click", () => galleryDialog.close());
galleryDialog.addEventListener("click", (event) => { if (event.target === galleryDialog) galleryDialog.close(); });
galleryDialog.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    selectGalleryImage(galleryIndex + (event.key === "ArrowRight" ? 1 : -1));
  }
});
galleryDialog.addEventListener("close", () => galleryOpen.focus({ preventScroll: true }));

for (const form of document.querySelectorAll(".option-notify")) {
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const email = form.querySelector("input[type=email]").value;
    form.querySelector("[role=status]").textContent = `Prototype only: ${email} would receive one email when registration opens.`;
  });
}
for (const button of document.querySelectorAll(".mock-action")) {
  button.addEventListener("click", () => {
    const feedback = document.getElementById("option-feedback");
    feedback.textContent = "Prototype only: a live checkout would confirm the total before any payment.";
    window.setTimeout(() => { feedback.textContent = ""; }, 5000);
  });
}

const initialHash = location.hash.slice(1);
const initial = initialHash.split("-")[0];
showOption(options.includes(initial) ? initial : "journal");
if (initialHash !== initial && document.getElementById(initialHash)) {
  history.replaceState(null, "", `#${initialHash}`);
  requestAnimationFrame(() => document.getElementById(initialHash).scrollIntoView());
}
