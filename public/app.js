const qs = new URLSearchParams(location.search);
const pathMatch = location.pathname.match(/^\/overlay\/([^\/?#]+)/);
const pathChannelId = pathMatch ? decodeURIComponent(pathMatch[1]) : "";

const channelId = qs.get("channelId") || pathChannelId || "";
const liveId = qs.get("liveId") || qs.get("videoId") || "";
const handle = qs.get("handle") || (channelId.startsWith("@") ? channelId : "");

const chatEl = document.getElementById("chat");
const maxMessages = Math.max(12, Math.min(260, Number(qs.get("max") || 140)));

const palette = ["#00FF3D", "#00D8FF", "#FF0040", "#B200FF", "#FF10C8", "#FF5500", "#FFD000"];
const ease = "cubic-bezier(0.2, 0.8, 0.2, 1)";

function hashString(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return h >>> 0;
}
function colorForChannelId(id) {
  return palette[hashString(id || "unknown") % palette.length];
}
function cleanName(name) {
  return String(name || "Unknown").replace(/^@+/, "");
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
  return img;
}

function buildMessageEl(chat) {
  const msg = document.createElement("div");
  msg.className = "msg";

  const line = document.createElement("div");
  line.className = "line";

  const prefix = document.createElement("span");
  prefix.className = "prefix";

  const badges = document.createElement("span");
  badges.className = "badges";

  const b = chat.badges || {};

  if (b.isOwner) badges.appendChild(makeBadge("/owner.png"));
  if (b.isVerified) badges.appendChild(makeBadge("/verified.png"));
  if (b.isModerator) badges.appendChild(makeBadge("/mod.png"));

  if (b.membership && b.membership.url) {
    const bi = document.createElement("img");
    bi.className = "badgeimg memberbadge";
    bi.referrerPolicy = "no-referrer";
    bi.src = b.membership.url;
    bi.alt = b.membership.alt || "";
    bi.decoding = "async";
    badges.appendChild(bi);
  }

  if (badges.children.length) prefix.appendChild(badges);

  const name = document.createElement("span");
  name.className = "name";
  name.textContent = cleanName(chat.author?.name);
  name.style.color = colorForChannelId(chat.author?.channelId || "");
  if (b.isModerator) name.classList.add("mod");

  const sep = document.createElement("span");
  sep.className = "sep";
  sep.textContent = ":";

  prefix.appendChild(name);
  prefix.appendChild(sep);

  const text = document.createElement("span");
  text.className = "text";

  const runs = Array.isArray(chat.message) ? chat.message : [];
  for (const r of runs) {
    if (r?.type === "text" && typeof r.text === "string") {
      const t = document.createElement("span");
      t.textContent = r.text;
      text.appendChild(t);
      continue;
    }
    if (r?.type === "emoji" && r.url) {
      const e = document.createElement("img");
      e.className = "emoji";
      e.referrerPolicy = "no-referrer";
      e.src = r.url;
      e.alt = r.alt || "";
      e.decoding = "async";
      text.appendChild(e);
    }
  }

  line.appendChild(prefix);
  line.appendChild(text);
  msg.appendChild(line);
  return msg;
}

function applyIndent(el) {
  const prefix = el.querySelector(".prefix");
  const text = el.querySelector(".text");
  if (!prefix || !text) return;
  const w = Math.ceil(prefix.getBoundingClientRect().width);
  text.style.setProperty("--indent", `${w}px`);
}

function trimForBatch(batchCount) {
  const keep = Math.max(0, maxMessages - batchCount);
  while (chatEl.children.length > keep) chatEl.removeChild(chatEl.firstChild);
}

function batchSizeForQueue(n) {
  if (n > 240) return 10;
  if (n > 160) return 8;
  if (n > 100) return 6;
  if (n > 50) return 4;
  if (n > 18) return 3;
  if (n > 6) return 2;
  return 1;
}

function durForQueue(n) {
  if (n > 220) return 130;
  if (n > 140) return 145;
  if (n > 80) return 160;
  if (n > 40) return 180;
  return 200;
}

const raf = () => new Promise(requestAnimationFrame);

const queue = [];
let pumping = false;

async function pushUpThenReveal(newEls, movers, beforeTops) {
  if (movers.length === 0) {
    for (const el of newEls) el.style.visibility = "visible";
    return;
  }

  await raf();

  const dur = durForQueue(queue.length);
  const anims = [];

  for (const el of movers) {
    const before = beforeTops.get(el);
    if (before == null) continue;
    const after = el.getBoundingClientRect().top;
    const dy = before - after;
    if (!dy) continue;

    if (el._anim) {
      try { el._anim.cancel(); } catch {}
      el._anim = null;
    }

    const anim = el.animate(
      [{ transform: `translateY(${dy}px)` }, { transform: "translateY(0px)" }],
      { duration: dur, easing: ease, fill: "both" }
    );
    el._anim = anim;
    anims.push(anim.finished.catch(() => {}));
  }

  await Promise.all(anims);

  for (const el of movers) {
    if (el._anim) {
      try { el._anim.cancel(); } catch {}
      el._anim = null;
    }
    el.style.transform = "";
  }

  for (const el of newEls) el.style.visibility = "visible";
}

async function pump() {
  if (pumping) return;
  pumping = true;

  while (queue.length) {
    const n = batchSizeForQueue(queue.length);
    trimForBatch(n);

    const movers = Array.from(chatEl.children);
    const beforeTops = new Map();
    for (const el of movers) beforeTops.set(el, el.getBoundingClientRect().top);

    const batchEls = [];
    const frag = document.createDocumentFragment();

    for (let i = 0; i < n && queue.length; i++) {
      const el = buildMessageEl(queue.shift());
      el.style.visibility = "hidden";
      frag.appendChild(el);
      batchEls.push(el);
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
