import { db, fb } from "../firebase-init.js";
import { $, esc, bootPage, busy, toast, setActiveProfile } from "../shared.js";

const { collection, addDoc, getDocs, query, where, doc, deleteDoc, writeBatch } = fb;
const OWNED = ["transactions", "liabilities", "assets", "stocks", "goals", "journalEntries"];
let user = null, profiles = [], toDelete = null;

const boot = await bootPage({ optionalAuth: false });
if (boot) { user = boot.user; await load(); }

async function load() {
  const snap = await getDocs(query(collection(db, "profiles"), where("uid", "==", user.uid)));
  profiles = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  render();
}

function render() {
  const cards = profiles.map((p) => `
    <div class="profile-card" role="button" tabindex="0" data-open="${esc(p.id)}">
      <div><h3>${esc(p.name)}</h3><span class="chip">${esc(p.mode)}</span></div>
      <button class="btn ghost sm del" data-del="${esc(p.id)}" aria-label="Delete ${esc(p.name)}" type="button">Delete</button>
    </div>`).join("");
  $("profilesGrid").innerHTML = cards + `<button class="profile-card new" id="newBtn" type="button"><span style="font-size:32px">+</span>New profile</button>`;
  $("newBtn").onclick = () => { $("newName").value = ""; $("newDlg").showModal(); $("newName").focus(); };
}

$("profilesGrid").addEventListener("click", (e) => {
  const del = e.target.closest("[data-del]");
  if (del) { e.stopPropagation(); return askDelete(del.dataset.del); }
  const open = e.target.closest("[data-open]");
  if (open) openProfile(open.dataset.open);
});
$("profilesGrid").addEventListener("keydown", (e) => {
  const open = e.target.closest("[data-open]");
  if (open && e.target === open && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openProfile(open.dataset.open); }
});

function openProfile(id) {
  const p = profiles.find((x) => x.id === id);
  if (!p) return;
  setActiveProfile(p.id, p.name, p.mode);
  location.href = String(p.mode).toLowerCase() === "business" ? "business.html" : "dashboard.html";
}

// ----- create -----
$("newCancel").onclick = () => $("newDlg").close();
$("newForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = $("newName").value.trim();
  if (!name) return;
  busy($("newOk"), async () => {
    await addDoc(collection(db, "profiles"), { uid: user.uid, name, mode: $("newMode").value, openingCash: 0, createdAt: new Date() });
    $("newDlg").close();
    toast("Profile created.", "good");
    await load();
  });
});

// ----- delete (cascades through every collection) -----
function askDelete(id) {
  toDelete = profiles.find((p) => p.id === id);
  if (!toDelete) return;
  $("delName").textContent = toDelete.name; $("delConfirm").value = ""; $("delOk").disabled = true;
  $("delDlg").showModal();
}
$("delConfirm").oninput = () => { $("delOk").disabled = $("delConfirm").value.trim() !== toDelete?.name; };
$("delCancel").onclick = () => $("delDlg").close();
$("delOk").onclick = () => busy($("delOk"), async () => {
  const id = toDelete.id;
  for (const name of OWNED) {
    const snap = await getDocs(query(collection(db, name), where("uid", "==", user.uid), where("profileId", "==", id)));
    for (let i = 0; i < snap.docs.length; i += 400) {
      const batch = writeBatch(db);
      snap.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  }
  await deleteDoc(doc(db, "taxSettings", id)).catch(() => {});
  await deleteDoc(doc(db, "profiles", id));
  if (localStorage.getItem("activeProfileId") === id) ["activeProfileId", "activeProfileName", "activeProfileMode"].forEach((k) => localStorage.removeItem(k));
  $("delDlg").close();
  toast("Profile deleted.", "good");
  await load();
});
