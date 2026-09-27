import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const root = path.resolve(import.meta.dirname, "..");
const ts = createRequire(path.join(root, "apps/site/package.json"))("typescript");
const reportPath = path.join(root, "docs/specs/fieldnotes-components-audit.json");
const hash = (text) => crypto.createHash("sha256").update(text).digest("hex");
const catalog = "accordion alert alert-dialog aspect-ratio attachment avatar badge breadcrumb bubble button button-group calendar card carousel chart checkbox collapsible combobox command context-menu data-table date-picker dialog direction drawer dropdown-menu empty field form hover-card input input-group input-otp item kbd label marker menubar message message-scroller native-select navigation-menu pagination popover progress radio-group resizable scroll-area select separator sheet sidebar skeleton slider sonner spinner switch table tabs textarea toggle toggle-group tooltip".split(" ");
const nativeTargets = { button: "button", input: "input", select: "native-select", textarea: "textarea", table: "table", thead: "table", tbody: "table", tr: "table", th: "table", td: "table", details: "accordion", summary: "accordion", dialog: "dialog", progress: "progress" };
const specialTargets = { StatusBadge: "badge", PillSelect: "radio-group", ShirtSizeSheet: "sheet", DynamicField: "field", Field: "field", FieldError: "field", RainbowButton: "button", Spinner: "spinner", NavProgressBar: "progress", StepRail: "progress", FieldFrame: "field", FormSelect: "select", DatePicker: "date-picker", ChoiceGroup: "radio-group", Status: "badge", EventCombobox: "combobox", SearchableCombobox: "combobox", DataTable: "data-table", SignupsChart: "chart", TicketCard: "card", TicketStub: "card", FieldnotesEventCard: "card", EventCard: "card", PhotoFramer: "dialog", CourseDrawEditor: "dialog", SiteNav: "button", RunnerTabBar: "button", AccountSectionNav: "button" };
function walk(dir) {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(file) : file.endsWith(".tsx") && !/\.test\.|\/__tests__\//.test(file) ? [file] : [];
  });
}
const files = ["apps/site/app", "apps/site/components", "apps/web/app", "apps/web/components"].flatMap(walk).sort();
function resolveImport(file, spec) {
  const base = spec.startsWith("@/") ? path.join("apps", file.split("/")[1], spec.slice(2)) : spec.startsWith(".") ? path.normalize(path.join(path.dirname(file), spec)) : null;
  return base ? [base, `${base}.tsx`, `${base}/index.tsx`].find((x) => files.includes(x)) : null;
}
function usesShared(file, seen = new Set()) {
  if (!file || seen.has(file)) return false;
  seen.add(file);
  const text = fs.readFileSync(path.join(root, file), "utf8");
  if (text.includes("@race-pace/ui") || text.includes('data-rp-ui="fieldnotes"')) return true;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return source.statements.filter(ts.isImportDeclaration).some(node => ts.isStringLiteral(node.moduleSpecifier) && usesShared(resolveImport(file, node.moduleSpecifier.text), seen));
}
const consumers = new Map(files.map((file) => [file, []]));
function inspect(file) {
  const text = fs.readFileSync(path.join(root, file), "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const imports = new Map();
  for (const node of source.statements) {
    if (!ts.isImportDeclaration(node) || !ts.isStringLiteral(node.moduleSpecifier)) continue;
    const spec = node.moduleSpecifier.text;
    const resolved = resolveImport(file, spec);
    if (resolved) consumers.get(resolved).push(file);
    const bindings = node.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) imports.set(item.name.text, spec);
  }
  const candidates = [];
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      const attributes = Object.fromEntries(node.attributes.properties.filter(ts.isJsxAttribute).map((a) => [a.name.getText(source), a.initializer && ts.isStringLiteral(a.initializer) ? a.initializer.text : a.initializer?.getText(source) ?? true]));
      const spec = imports.get(tag);
      const primitive = spec?.match(/(?:components\/ui\/|@race-pace\/ui\/ui\/)([\w-]+)/)?.[1];
      const roleTarget = attributes.role === "alert" ? "alert" : ["tab", "tablist", "tabpanel"].includes(attributes.role) ? "tabs" : ["radio", "radiogroup"].includes(attributes.role) ? "radio-group" : attributes.role === "dialog" ? "dialog" : null;
      const adapter = specialTargets[tag] && (spec === "@race-pace/ui" || usesShared(resolveImport(file, spec ?? "") ?? file));
      const target = primitive ?? nativeTargets[tag] ?? specialTargets[tag] ?? roleTarget;
      if (target) {
        const hidden = tag === "input" && attributes.type === "hidden";
        const fileInput = tag === "input" && attributes.type === "file";
        candidates.push({ line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, element: tag, target, attributes, finding: primitive ? "Existing primitive: consolidate and apply Fieldnotes component tokens" : hidden ? "Native hidden field: preserve form payload" : fileInput ? "Keep native file picker; provide keyboard-operable shared Button trigger" : "Native or dedicated UI: adopt matching canonical primitive", compatibility: hidden ? "name/value and native submission" : "Preserve handlers, controlled state, names, validation, refs and structural classes", verification: ["typecheck", "existing flow tests", "keyboard and responsive application review"], disposition: hidden || fileInput ? "preserve-native" : primitive ? "shared-primitive" : adapter ? "dedicated-shared-composition" : "migrate" });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return { file, owner: file.startsWith("apps/site/") ? "runner" : "admin", sha256: hash(text), candidates, disposition: candidates.length ? "migrate-primitives-preserve-composition" : "preserve-domain-or-route-wrapper", verification: candidates.length ? "Application types/tests plus responsive and keyboard review" : "Existing route/flow checks" };
}
const inventory = files.map(inspect);
for (const entry of inventory) entry.consumers = [...new Set(consumers.get(entry.file))].sort();

if (process.argv.includes("--baseline")) {
  if (fs.existsSync(reportPath)) throw new Error("Audit baseline already exists; never overwrite reviewed source evidence.");
  const used = new Set(inventory.flatMap((x) => x.candidates.map((y) => y.target)));
  for (const name of ["field", "input-group", "radio-group", "toggle-group", "accordion", "collapsible", "empty", "spinner", "progress", "slider", "combobox", "data-table"]) used.add(name);
  const report = { base: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), date: "2026-09-27", scope: "Runner and Admin React source; component-only Fieldnotes migration", catalog: catalog.map((name) => ({ name, disposition: used.has(name) ? "adopt-or-compose" : "unused-preserve-specialized-behavior", note: used.has(name) ? "Use matching canonical source without catalog sample data" : "Do not introduce a workflow solely to use this component" })), files: inventory };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  const lines = ["# Fieldnotes component source audit", "", `Baseline: \`${report.base}\`. ${inventory.length} non-test TSX modules. Counts refer to source expressions, not rendered controls.`, "", "The JSON inventory records every module, consumer, candidate source location, target, finding, compatibility requirement and verification. Native hidden/file fields are deliberate exceptions. Dedicated compositions and route wrappers remain intact.", "", "## Source checklist", "", "| Owner | Source | Candidates | Targets | Disposition |", "|---|---|---:|---|---|"];
  for (const entry of inventory) lines.push(`| ${entry.owner} | \`${entry.file}\` | ${entry.candidates.length} | ${[...new Set(entry.candidates.map((x) => x.target))].sort().join(", ") || "—"} | ${entry.disposition} |`);
  lines.push("", "## Complete catalog mapping", "", "| Component | Disposition |", "|---|---|");
  for (const entry of report.catalog) lines.push(`| ${entry.name} | ${entry.disposition} |`);
  fs.writeFileSync(reportPath.replace(".json", ".md"), `${lines.join("\n")}\n`);
  console.log(`Recorded ${inventory.length} modules, ${inventory.reduce((n, x) => n + x.candidates.length, 0)} UI candidate sites and ${catalog.length} catalog dispositions.`);
} else {
  const baseline = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  const uiRoot = path.join(root, "packages/ui");
  const sync = JSON.parse(fs.readFileSync(path.join(uiRoot, "SOURCE_SYNC.json"), "utf8"));
  const snapshots = [
    ...sync.files.filter(entry => entry.destination !== "reference-only").map(entry => ({ path: entry.destination, sha256: entry.adaptedSha256 })),
    ...(sync.adaptedFiles ?? []),
  ];
  const drift = snapshots.filter(entry => hash(fs.readFileSync(path.join(uiRoot, entry.path))) !== entry.sha256);
  if (process.argv.includes("--verify") && drift.length) {
    console.error(drift.map(entry => `packages/ui/${entry.path}: source snapshot hash differs`).join("\n"));
    process.exitCode = 1;
  }

  const exemptionsPath = path.join(root, "docs/specs/fieldnotes-component-exceptions.json");
  const exemptions = fs.existsSync(exemptionsPath) ? JSON.parse(fs.readFileSync(exemptionsPath, "utf8")) : [];
  const unresolved = inventory.flatMap((entry) => entry.file.includes("/components/ui/") ? [] : entry.candidates.filter((x) => x.disposition === "migrate" && !exemptions.some((e) => e.file === entry.file && e.element === x.element && e.target === x.target)).map((x) => `${entry.file}:${x.line} ${x.element} -> ${x.target}`));
  const primitiveCopies = inventory.filter((x) => x.file.includes("/components/ui/") && !/searchable-combobox|rainbow-button/.test(x.file) && !fs.readFileSync(path.join(root, x.file), "utf8").includes('@race-pace/ui/'));
  if (process.argv.includes("--verify") && (unresolved.length || primitiveCopies.length)) {
    console.error([...unresolved, ...primitiveCopies.map((x) => `${x.file}: duplicated primitive`)].join("\n"));
    process.exitCode = 1;
  }
  if (process.argv.includes("--reconcile")) {
    const report = { baseline: baseline.base, currentFiles: inventory, unresolved, primitiveCopies: primitiveCopies.map(x => x.file),
      catalog: catalog.map(name => ({ name, disposition: inventory.some(file => file.candidates.some(candidate => candidate.target === name)) || sync.files.some(file => file.destination === `src/ui/${name}.tsx`) ? "shared-primitive-or-dedicated-composition" : "unused", note: "Preserve specialized behavior and section/layout boundaries" })) };
    fs.writeFileSync(path.join(root, "docs/specs/fieldnotes-components-reconciliation.json"), JSON.stringify(report, null, 2) + "\n");
  }
  console.log(`${inventory.length} current modules; ${baseline.files.length} audited; ${unresolved.length} remaining native/dedicated sites; ${primitiveCopies.length} duplicated primitives.`);
}
