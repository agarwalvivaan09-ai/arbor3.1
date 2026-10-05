import { $, esc, bootPage } from "../shared.js";
import { DEVELOPER as D } from "../developer-config.js";
import { APP_VERSION } from "../config.js";

await bootPage({ optionalAuth: true });
const safeUrl = (u) => (/^(https?:\/\/|mailto:)/i.test(u) ? u : "");
const initials = D.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

$("hero").innerHTML = `
  <div class="avatar">${D.photo ? `<img src="${esc(D.photo)}" alt="${esc(D.name)}">` : esc(initials)}</div>
  <div><h1 style="margin-bottom:6px">${esc(D.name)}</h1>
  ${D.tagline ? `<p style="margin-bottom:8px">${esc(D.tagline)}</p>` : ""}
  <div class="chips">${[D.school, D.location].filter(Boolean).map((t) => `<span class="chip">${esc(t)}</span>`).join("")}
  ${D.email ? `<a class="chip" href="mailto:${esc(D.email)}">${esc(D.email)}</a>` : ""}</div></div>`;

const fill = (cardId, items, html) => { if (!items || !items.length) $(cardId).classList.add("hide"); else html(); };
fill("aboutCard", D.about, () => { $("about").innerHTML = D.about.map((p) => `<p>${esc(p)}</p>`).join(""); });
fill("linksCard", D.links, () => { $("links").innerHTML = D.links.filter((l) => safeUrl(l.url)).map((l) => `<a class="link-card" href="${esc(safeUrl(l.url))}" target="_blank" rel="noopener"><strong>${esc(l.label)} ↗</strong>${l.note ? `<small class="muted">${esc(l.note)}</small>` : ""}</a>`).join(""); });
fill("skillsCard", D.skills, () => { $("skills").innerHTML = D.skills.map((s) => `<span class="chip">${esc(s)}</span>`).join(""); });
fill("projectsCard", D.projects, () => { $("projects").innerHTML = D.projects.map((p) => `<div class="link-card"><strong>${esc(p.name)}${p.year ? ` <span class="muted">· ${esc(p.year)}</span>` : ""}</strong><span>${esc(p.text)}</span>${safeUrl(p.url) ? `<a href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener">Open ↗</a>` : ""}</div>`).join(""); });
fill("timelineCard", D.timeline, () => { $("timeline").innerHTML = D.timeline.map((t) => `<div><strong>${esc(t.when)}</strong><br>${esc(t.what)}</div>`).join(""); });
$("ver").textContent = `v${APP_VERSION}`;
$("contactNote").textContent = D.contactNote || "";
