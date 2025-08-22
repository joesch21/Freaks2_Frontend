// participants-drawer.js
import { ethers } from "ethers";
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
  } catch {/* guest ok */}

  el("ff-open-participants")?.addEventListener("click", openDrawer);
  el("ff-close-participants")?.addEventListener("click", closeDrawer);
  el("ff-drawer-overlay")?.addEventListener("click", closeDrawer);
  el("ff-refresh-participants")?.addEventListener("click", () => loadParticipants(true));

  await loadParticipants(true);
  game.on("Joined", () => loadParticipants(false));
  game.on("RoundCompleted", () => loadParticipants(true));
  setInterval(() => loadParticipants(false), 15000);
}

async function loadParticipants() {
  try {
    const list = await game.getParticipants();
    el("ff-participant-count") && (el("ff-participant-count").textContent = list.length ?? 0);
    el("ff-player-count") && (el("ff-player-count").textContent = list.length ?? 0);

    const wrap = el("participantList");
    if (!wrap) return;
    wrap.innerHTML = "";

    if (!list || !list.length) {
      wrap.innerHTML = `<li class="ff-row">No one has joined yet. Be the first!</li>`;
      return;
    }

    list.forEach((addr) => {
      const a = addr.toLowerCase();
      const row = document.createElement("li");
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
        try { await navigator.clipboard.writeText(a); e.currentTarget.textContent = "Copied"; setTimeout(()=>e.currentTarget.textContent="Copy",1000); } catch {}
      });
    });
  } catch (e) { console.warn("loadParticipants failed", e); }
}

function openDrawer(){ el("ff-drawer")?.classList.add("open"); el("ff-drawer-overlay")?.classList.add("show"); }
function closeDrawer(){ el("ff-drawer")?.classList.remove("open"); el("ff-drawer-overlay")?.classList.remove("show"); }

if (document.readyState !== "loading") initParticipantsUI();
else document.addEventListener("DOMContentLoaded", initParticipantsUI);
