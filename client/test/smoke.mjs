// Headless render smoke test (I1). Mounts <App/> in jsdom with stubbed data
// and walks the tabs, failing if anything throws or a tab renders blank.
// This catches the "uses an undefined variable → blank white screen" class of
// bug that a normal build does NOT catch (building ≠ rendering).
//
//   cd client && npm run test:smoke
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
process.on("unhandledRejection", () => {}); // recharts can't import headlessly; ignore

// 1) transpile/bundle the app (node_modules stay external, resolved at runtime)
await build({
  entryPoints: [join(here, "../src/App.jsx")],
  outdir: join(here, ".tmp"),
  bundle: true, format: "esm", splitting: true, packages: "external",
  jsx: "automatic", define: { "import.meta.env": "{}" }, logLevel: "silent",
});

// 2) jsdom globals
const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", { url: "http://localhost/", pretendToBeVisual: true });
for (const k of ["window", "document", "HTMLElement", "Element", "Node", "getComputedStyle"]) globalThis[k] = dom.window[k];
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.performance = { now: () => Date.now() };
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }; // jsdom lacks it; recharts needs it
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// 3) stubbed server
const STATE = {
  rev: 1,
  accounts: [{ id: "chk", name: "Checking", type: "checking", color: "#94A3B8" }, { id: "sav", name: "Savings", type: "savings", color: "#94A3B8" }],
  snapshots: [{ id: "s1", accountId: "chk", date: "2026-04-01T00:00:00Z", balance: 3000 }, { id: "s2", accountId: "sav", date: "2026-06-01T00:00:00Z", balance: 9000 }],
  goals: [{ id: "japan", name: "Japan", target: 5000, pledge: 300, color: "#F59E0B", targetDate: "2026-12-01T00:00:00Z" }],
  debts: [{ id: "d1", name: "Chase", balance: 1200, apr: 24, minPayment: 45 }],
  transactions: [
    { id: "t1", type: "contribution", amount: 300, date: "2026-06-10T00:00:00Z", goalId: "japan" },
    { id: "t2", type: "spending", amount: 1200, date: "2026-06-12T00:00:00Z", cat: "Dining Out" },
    { id: "t3", type: "income", amount: 5000, date: "2026-06-05T00:00:00Z" },
  ],
  profile: {
    name: "Sam", birthYear: 1995, retireAge: 60,
    incomeSources: [{ id: "job", name: "Day job", type: "salary", typicalMonthly: 5000 }],
    strategy: "balanced", debtStrategy: "avalanche", checkingFloor: 3000, emergencyTarget: 10000,
    bills: [{ id: "rent", name: "Rent", amount: 1500, dayOfMonth: 1 }],
    moneyTargets: [{ id: "t", label: "Save $5k", amount: 5000, metric: "contributed" }],
  },
  settings: { returnRate: 0.07, monthlyInvest: null, onboarded: true },
};
const PLAN = { income: 5000, strategy: "balanced", allocated: 5000, leftover: 0, investable: 2000, steps: [{ key: "brokerage", label: "Invest", amount: 2000, why: "x" }] };
globalThis.fetch = async (url) => ({ ok: true, status: 200, json: async () => (String(url).includes("/api/plan") ? PLAN : STATE), text: async () => "" });

const errors = [];
dom.window.addEventListener("error", (e) => errors.push(e.error?.message || e.message));

// 4) mount + walk (Grow skipped — recharts won't import in headless node)
const React = (await import("react")).default;
const { createRoot } = await import("react-dom/client");
const { act } = await import("react");
const { default: App } = await import(join(here, ".tmp/App.js"));

const root = createRoot(document.getElementById("root"));
const fails = [];
await act(async () => { root.render(React.createElement(App)); });
await new Promise((r) => setTimeout(r, 250));

// nav buttons live in the sidebar and include an emoji icon, so match by label-includes
const navTo = async (label) => {
  const aside = document.querySelector("aside");
  const b = [...(aside?.querySelectorAll("button") || [])].find((x) => x.textContent.includes(label));
  if (!b) return false;
  await act(async () => b.click());
  await new Promise((r) => setTimeout(r, 120));
  return true;
};

for (const name of ["Plan", "Activity", "Grow", "Goals", "Settings", "Home"]) {
  try {
    if (!(await navTo(name))) { fails.push(`${name}: no nav button`); continue; }
    const len = document.querySelector("main")?.innerHTML.length || 0;
    if (len < 50) fails.push(`${name}: blank`);
    else console.log(`  ✓ ${name}`);
  } catch (e) { fails.push(`${name}: ${e.message}`); }
}

// ── interaction smoke: exercise the main mutation handlers (user-triggered) ──
const setValue = (el, v) => {
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value").set.call(el, v);
  el.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
};
const btnByText = (txt, root = document) => [...root.querySelectorAll("button")].find((b) => b.textContent.trim() === txt);

try { // open quick-add, switch types, enter an amount, log
  const fab = document.querySelector('button[aria-label="Log a transaction"]');
  if (!fab) throw new Error("no + button");
  await act(async () => fab.click());
  await new Promise((r) => setTimeout(r, 80));
  const dialog = document.querySelector('[role="dialog"]');
  if (!dialog) throw new Error("quick-add sheet did not open");
  for (const t of ["Income", "Contribution", "Spending"]) { const b = btnByText(t, dialog); if (b) await act(async () => b.click()); }
  const amt = dialog.querySelector('input[type="number"]');
  if (amt) await act(async () => setValue(amt, "50"));
  const logBtn = [...dialog.querySelectorAll("button")].find((b) => b.textContent.trim().startsWith("Log"));
  if (logBtn) await act(async () => logBtn.click());
  await new Promise((r) => setTimeout(r, 150));
  if (document.querySelector('[role="dialog"]')) fails.push("quick-add: sheet didn't close after logging");
  else console.log("  ✓ quick-add: log");
} catch (e) { fails.push(`quick-add interaction: ${e.message}`); }

try { // Activity → List view → delete a ledger row
  await navTo("Activity");
  const listBtn = btnByText("List"); if (listBtn) await act(async () => listBtn.click());
  await new Promise((r) => setTimeout(r, 80));
  const del = document.querySelector('button[aria-label="Delete"]');
  if (!del) fails.push("ledger: no delete button found");
  else { await act(async () => del.click()); await new Promise((r) => setTimeout(r, 80)); console.log("  ✓ activity: list delete"); }
} catch (e) { fails.push(`activity interaction: ${e.message}`); }

try { // Settings: save profile + dark-mode toggle (now in Appearance)
  await navTo("Settings");
  const save = btnByText("Save profile");
  if (!save) fails.push("settings: no Save profile button found");
  else { await act(async () => save.click()); await new Promise((r) => setTimeout(r, 80)); console.log("  ✓ settings: save profile"); }
  const darkBtn = btnByText("Dark");
  if (!darkBtn) fails.push("theme: no Dark button in Settings");
  else { await act(async () => darkBtn.click()); await new Promise((r) => setTimeout(r, 60));
    if (document.documentElement.classList.contains("dark")) console.log("  ✓ settings: dark mode");
    else fails.push("theme: .dark class not applied"); }
} catch (e) { fails.push(`settings interaction: ${e.message}`); }

if (errors.length) fails.push(...errors.map((e) => `render error: ${e}`));
if (fails.length) { console.error("\nSMOKE TEST FAILED:\n - " + fails.join("\n - ")); process.exit(1); }
console.log("\nSMOKE TEST PASSED");
process.exit(0);
