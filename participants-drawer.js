// participants-drawer.js
import gameAbi from "./abi/freakyFridayGameAbi.js";
import { FREAKY_CONTRACT } from "./frontendinfo.js";

const el = (id) => document.getElementById(id);
const short = (a) => (a ? `${a.slice(0,6)}…${a.slice(-4)}` : "");

let provider, game, userAddr;

export async function initParticipantsUI() {
  provider = new ethers.BrowserProvider(window.ethereum);
  game = new ethers.Contract(FREAKY_CONTRACT, gameAbi, provider);

  try {
    await provider.send("eth_requestAccounts", []);
    const signer = await provider.getSigner();
    userAddr = (await signer.getAddress()).toLowerCase();
  } catch {/* guest view is fine */}

  el("ff-open-participants").onclick  = openDrawer;
  el("ff-close-participants").onclick = closeDrawer;
  el("ff-drawer-overlay").onclick     = closeDrawer;
  el("ff-refresh-participants").onclick = () => loadParticipants(true);

  await loadParticipants(true);
  game.on("Joined", async () => loadParticipants(false));
}

async function loadParticipants(updateCount) {
  try {
    const list = await game.getParticipants(); // address[]
    renderList(list);
    if (updateCount) el("ff-participant-count").textContent = list.length ?? 0;
  } catch (e) { console.warn("loadParticipants failed", e); }
}

function renderList(list) {
  const wrap = el("ff-participants-list");
  wrap.innerHTML = "";
  if (!list || !list.length) {
    wrap.innerHTML = `<div class="ff-row">No one has joined yet. Be the first!</div>`;
    el("ff-participant-count").textContent = 0;
    return;
  }
  el("ff-participant-count").textContent = list.length;

  list.forEach((addr) => {
    const a = addr.toLowerCase();
    const row = document.createElement("div");
    row.className = "ff-row";
    row.innerHTML = `
      <div class="ff-ava">${short(a).slice(2,3).toUpperCase()}</div>
      <div class="ff-addr">${a}</div>
      ${userAddr && a === userAddr ? `<span class="ff-badge">You</span>` : ""}
      <button class="ff-copy" data-addr="${a}" aria-label="Copy address">Copy</button>
    `;
    wrap.appendChild(row);
  });

  wrap.querySelectorAll(".ff-copy").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const a = e.currentTarget.getAttribute("data-addr");
      try {
        await navigator.clipboard.writeText(a);
        e.currentTarget.textContent = "Copied";
        setTimeout(() => (e.currentTarget.textContent = "Copy"), 1000);
      } catch {}
    });
  });
}

function openDrawer() {
  el("ff-drawer").classList.add("open");
  el("ff-drawer-overlay").classList.add("show");
  el("ff-drawer").setAttribute("aria-hidden", "false");
}
function closeDrawer() {
  el("ff-drawer").classList.remove("open");
  el("ff-drawer-overlay").classList.remove("show");
  el("ff-drawer").setAttribute("aria-hidden", "true");
}

if (document.readyState !== "loading") initParticipantsUI();
else document.addEventListener("DOMContentLoaded", initParticipantsUI);
