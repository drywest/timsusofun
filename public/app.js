const qs = new URLSearchParams(location.search);
const channelId = qs.get("channelId") || "";
const liveId = qs.get("liveId") || qs.get("videoId") || "";
const handle = qs.get("handle") || (channelId.startsWith("@") ? channelId : "");

const chatEl = document.getElementById("chat");
const starCol = document.getElementById("starCol");

const queue = [];
let pumping = false;

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (s) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[s]));
}

function isBlockedBot(name) {
  const n = String(name || "").trim().toLowerCase().replace(/\s+/g, "");
  return n === "nightbot" || n === "streamelements";
}

function preventScroll(e) { e.preventDefault(); }
window.addEventListener("wheel", preventScroll, { passive: false });
window.addEventListener("touchmove", preventScroll, { passive: false });
window.addEventListener("keydown", (e) => {
  const keys = ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "];
  if (keys.includes(e.key)) e.preventDefault();
}, { passive: false });

function makeBadge(src, cls) {
  const img = document.createElement("img");
  img.className = cls ? `badgeimg ${cls}` : "badgeimg";
  img.src = src;
  img.alt = "";
  img.decoding = "async";
  img.loading = "lazy";
  return img;
}

function makeName(author) {
  const span = document.createElement("span");
  span.className = "name";
  if (author?.isOwner) span.classList.add("owner");
  if (author?.isModerator) span.classList.add("mod");
  span.textContent = author?.name || "";
  return span;
}

function makePhoto(url) {
  const img = document.createElement("img");
  img.className = "photo";
  img.src = url || "";
  img.alt = "";
  img.decoding = "async";
  img.loading = "lazy";
  return img;
}

function formatMessage(msg) {
  const span = document.createElement("span");
  span.className = "msg";
  span.innerHTML = escapeHtml(msg || "");
  return span;
}

function createChatEl(data) {
  const row = document.createElement("div");
  row.className = "row";

  const left = document.createElement("div");
  left.className = "left";
  left.appendChild(makePhoto(data?.author?.photo));

  const right = document.createElement("div");
  right.className = "right";

  const meta = document.createElement("div");
  meta.className = "meta";

  const badgesWrap = document.createElement("span");
  badgesWrap.className = "badges";

  const badges = data?.author?.badges || [];
  for (const b of badges) badgesWrap.appendChild(makeBadge(b));

  meta.appendChild(badgesWrap);
  meta.appendChild(makeName(data?.author));

  const content = document.createElement("div");
  content.className = "content";
  content.appendChild(formatMessage(data?.message));

  right.appendChild(meta);
  right.appendChild(content);

  row.appendChild(left);
  row.appendChild(right);

  return row;
}

function applyIndent(el) {
  const nameEl = el.querySelector(".name");
  const msgEl = el.querySelector(".msg");
  if (!nameEl || !msgEl) return;

  const nameWidth = Math.ceil(nameEl.getBoundingClientRect().width);
  msgEl.style.marginLeft = `${nameWidth + 16}px`;
}

async function pushUpThenReveal(newEls, movers, beforeTops) {
  const afterTops = new Map();
  for (const el of movers) afterTops.set(el, el.getBoundingClientRect().top);

  for (const el of movers) {
    const dy = (beforeTops.get(el) || 0) - (afterTops.get(el) || 0);
    el.style.transform = `translateY(${dy}px)`;
  }

  // force reflow
  void document.body.offsetHeight;

  for (const el of movers) {
    el.style.transition = "transform 260ms ease";
    el.style.transform = "translateY(0)";
  }

  for (const el of newEls) el.classList.add("show");

  await new Promise((r) => setTimeout(r, 280));

  for (const el of movers) {
    el.style.transition = "";
    el.style.transform = "";
  }
}

async function pump() {
  if (pumping) return;
  pumping = true;

  while (queue.length > 0) {
    const batch = queue.splice(0, 6);

    const movers = Array.from(chatEl.children);
    const beforeTops = new Map();
    for (const el of movers) beforeTops.set(el, el.getBoundingClientRect().top);

    const frag = document.createDocumentFragment();
    const batchEls = [];
    for (const msg of batch) {
      const el = createChatEl(msg);
      batchEls.push(el);
      frag.appendChild(el);
    }

    chatEl.appendChild(frag);

    for (const el of batchEls) applyIndent(el);

    await pushUpThenReveal(batchEls, movers, beforeTops);
  }

  pumping = false;
}

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const wsUrl = new URL(`${proto}://${location.host}/ws`);
  if (liveId) wsUrl.searchParams.set("liveId", liveId);
  if (channelId) wsUrl.searchParams.set("channelId", channelId);
  if (handle) wsUrl.searchParams.set("handle", handle);

  const ws = new WebSocket(wsUrl.toString());

  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }

    if (msg.type === "error") {
      const m = msg.data?.message || "Server error";
      const d = msg.data?.details ? ` (${msg.data.details})` : "";
      console.error(`[overlay] ${m}${d}`);
      return;
    }

    if (msg.type === "chat") {
      const author = msg.data?.author?.name || "";
      if (isBlockedBot(author)) return;
      queue.push(msg.data);
      pump();
    }
  };

  ws.onclose = () => setTimeout(connect, 200);
  ws.onerror = () => ws.close();
}

if (channelId || liveId || handle) connect();
