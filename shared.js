import { auth, onAuthStateChanged, signOut } from "./firebase-init.js";

// ---------- tiny helpers ----------
export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
export const inr = (v, dp = 0) => {
  const x = Number(v);
  if (!Number.isFinite(x)) return "–";
  return (x < 0 ? "-₹ " : "₹ ") + Math.abs(x).toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
};
export const inrShort = (v) => {
  const x = Number(v) || 0, a = Math.abs(x), s = x < 0 ? "-" : "";
  if (a >= 1e7) return `${s}₹${(a / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `${s}₹${(a / 1e5).toFixed(2)} L`;
  if (a >= 1e3) return `${s}₹${(a / 1e3).toFixed(1)}K`;
  return `${s}₹${a.toFixed(0)}`;
};
export const pct = (r, dp = 1) => (Number.isFinite(r) ? `${(r * 100).toFixed(dp)}%` : "–");
export const setText = (id, v) => { const el = $(id); if (el) el.textContent = v; };
export const readNum = (id) => { const el = $(id); const v = el && el.value.trim() !== "" ? Number(el.value) : NaN; return v; };
export const readStr = (id) => ($(id)?.value || "").trim();

export async function busy(btn, fn) {
  if (btn) { btn.disabled = true; btn.dataset.label = btn.textContent; btn.textContent = "Working…"; }
  try { return await fn(); }
  catch (e) { console.error(e); toast(friendlyError(e), "bad"); }
  finally { if (btn) { btn.disabled = false; btn.textContent = btn.dataset.label; } }
}
export function friendlyError(e) {
  const c = e?.code || "";
  if (c.includes("permission-denied")) return "Permission denied. Check that the Firestore rules are deployed and you are signed in.";
  if (c.includes("unavailable") || c.includes("network")) return "Network problem. Check your connection and try again.";
  return e?.message || "Something went wrong.";
}

// ---------- toast ----------
export function toast(msg, kind = "info", ms = 3800) {
  let host = $("toasts");
  if (!host) { host = document.createElement("div"); host.id = "toasts"; host.setAttribute("aria-live", "polite"); document.body.appendChild(host); }
  const t = document.createElement("div");
  t.className = `toast ${kind}`; t.textContent = msg;
  host.appendChild(t);
  setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 300); }, ms);
}

// ---------- theme ----------
export function applyTheme() {
  const saved = localStorage.getItem("arbor.theme");
  const theme = saved || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  document.documentElement.dataset.theme = theme;
}
function toggleTheme() {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  localStorage.setItem("arbor.theme", next); document.documentElement.dataset.theme = next;
  window.dispatchEvent(new Event("themechange"));
}

// ---------- profile state ----------
export function getActiveProfile() {
  const mode = (localStorage.getItem("activeProfileMode") || "").toLowerCase();
  return {
    id: localStorage.getItem("activeProfileId") || "",
    name: localStorage.getItem("activeProfileName") || "",
    mode, kind: mode === "business" ? "business" : "personal", // "family" is treated as personal
  };
}
export function setActiveProfile(id, name, mode) {
  localStorage.setItem("activeProfileId", id);
  localStorage.setItem("activeProfileName", name);
  localStorage.setItem("activeProfileMode", String(mode).trim().toLowerCase());
}

// ---------- navigation ----------
const NAV = {
  personal: [["dashboard.html", "Dashboard"], ["analytics.html", "Resilience"], ["stocks.html", "Portfolio"], ["quant.html", "Quant Lab"], ["guide.html", "Guide"], ["developer.html", "Developer"]],
  business: [["business.html", "Dashboard"], ["business-journal.html", "Journal"], ["business-ledger.html", "Ledger"], ["business-trial.html", "Trial Balance"], ["business-finalaccounts.html", "Final Accounts"], ["business-analytics.html", "Analytics"], ["guide.html", "Guide"], ["developer.html", "Developer"]],
  guest: [["index.html", "Sign in"], ["guide.html", "Guide"], ["developer.html", "Developer"]],
};

export function mountShell({ kind, user, profile }) {
  const here = location.pathname.split("/").pop() || "index.html";
  const links = (NAV[kind] || NAV.guest).map(([href, text]) => `<a href="${href}"${href === here ? ' aria-current="page"' : ""}>${text}</a>`).join("");
  const chip = profile?.name ? `<a class="chip" href="profiles.html" title="Switch profile">${esc(profile.name)} · ${esc(profile.mode || "personal")}</a>` : "";
  const header = document.createElement("div");
  header.innerHTML = `
    <a class="skip" href="#main">Skip to content</a>
    <header class="topbar">
      <a class="brand" href="${user ? "profiles.html" : "index.html"}"><span class="logo" aria-hidden="true">A</span>Arbor</a>
      <nav class="nav" aria-label="Main">${links}</nav>
      <div class="top-actions">
        ${chip}
        <button class="btn ghost sm icon" id="themeBtn" type="button" aria-label="Toggle light or dark theme">◐</button>
        ${user ? '<button class="btn ghost sm" id="signOutBtn" type="button">Sign out</button>' : '<a class="btn primary sm" href="index.html">Sign in</a>'}
      </div>
    </header>`;
  document.body.prepend(...header.children);
  $("themeBtn").onclick = toggleTheme;
  const so = $("signOutBtn");
  if (so) so.onclick = async () => { await signOut(auth); location.href = "index.html"; };
  const current = document.querySelector('.nav [aria-current="page"]');
  current?.scrollIntoView({ inline: "center", block: "nearest" });
}

export function waitForUser() {
  return new Promise((resolve) => { const off = onAuthStateChanged(auth, (u) => { off(); resolve(u); }); });
}

/**
 * Standard page boot: theme, auth guard, profile guard, shell.
 * kind: "personal" | "business" | undefined (public pages with optionalAuth)
 */
export async function bootPage({ kind, optionalAuth = false } = {}) {
  applyTheme();
  const user = await waitForUser();
  if (!user && !optionalAuth) { location.replace("index.html"); return null; }
  const profile = getActiveProfile();
  if (user && kind) {
    if (!profile.id) { location.replace("profiles.html"); return null; }
    if (profile.kind !== kind) { location.replace(profile.kind === "business" ? "business.html" : "dashboard.html"); return null; }
  }
  const navKind = !user ? "guest" : (kind || (profile.id ? profile.kind : "personal"));
  mountShell({ kind: navKind, user, profile: user && profile.id ? profile : null });
  return { user, profile };
}

// ---------- charts ----------
export function fanChart(canvasId, bands, { label = "Median" } = {}) {
  const canvas = $(canvasId);
  if (!canvas || typeof Chart === "undefined") return;
  canvas._chart?.destroy();
  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue("--accent").trim() || "#34d399";
  const muted = css.getPropertyValue("--muted").trim() || "#93a1b3";
  const grid = css.getPropertyValue("--border").trim() || "#243040";
  const years = bands.p50.map((_, i) => (i === 0 ? "Now" : `Y${i}`));
  const line = (data, name, extra = {}) => ({ label: name, data, borderWidth: 1.5, pointRadius: 0, tension: 0.25, ...extra });
  canvas._chart = new Chart(canvas.getContext("2d"), {
    type: "line",
    data: {
      labels: years,
      datasets: [
        line(bands.p95, "95th percentile", { borderColor: "transparent", backgroundColor: accent + "22", fill: "+1" }),
        line(bands.p75, "75th", { borderColor: "transparent", backgroundColor: accent + "33", fill: "+1" }),
        line(bands.p50, label, { borderColor: accent, borderWidth: 2.5 }),
        line(bands.p25, "25th", { borderColor: "transparent", backgroundColor: accent + "33", fill: "-1" }),
        line(bands.p5, "5th percentile", { borderColor: "transparent", backgroundColor: accent + "22", fill: "-1" }),
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${inrShort(c.parsed.y)}` } } },
      scales: { x: { ticks: { color: muted }, grid: { display: false } }, y: { ticks: { color: muted, callback: (v) => inrShort(v) }, grid: { color: grid } } },
    },
  });
}
window.addEventListener("themechange", () => document.querySelectorAll("canvas").forEach((c) => c._rerender?.()));
