// server.js
import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import { Innertube, UniversalCache } from "youtubei.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

app.use(cors());
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (_req, res) =>
  res.sendFile(path.join(__dirname, "public", "index.html")),
);
app.get("/overlay/:channelId", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "overlay.html")),
);

const PORT = process.env.PORT || 3000;

// --- FIX: lazy + resilient YouTube client init (prevents early exit) ---
let YT_READY = null;          // will hold a Promise<Innertube> once started
async function getYT() {
  if (YT_READY) return YT_READY;
  YT_READY = Innertube.create({ cache: new UniversalCache(true) })
    .catch((e) => {
      console.error("[Innertube.create] failed:", e);
      // Allow retry on next call instead of crashing process:
      YT_READY = null;
      return null;
    });
  return YT_READY;
}
// -----------------------------------------------------------------------

const managers = new Map();

class ChatManager {
  constructor(channelId, yt) {
    this.channelId = channelId;
    this.yt = yt;
    this.livechat = null;
    this.videoId = null;
    this.clients = new Set();
    this.timer = null;
    this.stopped = false;

    // Batch outgoing messages to avoid WS backlog when chat is fast
    this.outQueue = [];
    this.flushTimer = null;

    // Avoid repeating "Waiting for stream…" spam
    this.waitingShown = false;
  }

  addClient(ws) {
    this.clients.add(ws);
    ws.on("close", () => this.clients.delete(ws));
  }

  broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const ws of this.clients) if (ws.readyState === 1) ws.send(data);
  }

  // enqueue + flush as a single batch per tick
  enqueueMessage(message) {
    this.outQueue.push(message);
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      try {
        const batch = this.outQueue;
        this.outQueue = [];
        if (batch.length) this.broadcast({ type: "batch", messages: batch });
      } finally {
        this.flushTimer = null;
      }
    }, 0);
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    try {
      this.livechat?.stop();
    } catch {}
    this.livechat = null;
  }

  async start() {
    this.stopped = false;
    await this.loop();
  }

  async loop() {
    if (this.stopped) return;
    try {
      if (!this.livechat) await this.attach();
    } catch {
      if (!this.waitingShown) {
        this.waitingShown = true;
        // Suppress all system/status messages while waiting.
      }
    } finally {
      this.timer = setTimeout(() => this.loop(), 800); // <- your polling frequency (unchanged)
    }
  }

  async attach() {
    const info = await resolveLiveInfo(this.yt, this.channelId);
    if (!info) throw new Error("No live found");
    const chat = info.getLiveChat?.();
    if (!chat) throw new Error("Live chat not available");

    this.videoId = info?.basic_info?.id || info?.id || null;
    this.livechat = chat;

    // Reset "waiting…" gate once we have a live chat
    this.waitingShown = false;

    // Force ALL messages (not Top Chat) and keep re-applying
    ensureAllChat(chat);

    // HARD disable smoothing so we get events ASAP
    try {
      if (chat.smoothed_queue) {
        chat.smoothed_queue.setEnabled?.(false);
        chat.smoothed_queue.enabled = false;
        chat.smoothed_queue.setEmitDelay?.(0);
        chat.smoothed_queue.setMaxBatchSize?.(1);
        const directEmit = (arr) => {
          try {
            chat.emit?.("actions", arr);
          } catch {}
        };
        chat.smoothed_queue.push = (arr) => directEmit(arr);
        chat.smoothed_queue.clear?.();
      }
    } catch {}

    const handle = (evt) => {
      try {
        const arr = normalizeActions(evt);
        if (!arr.length) return;
        for (const m of parseActions(arr)) this.enqueueMessage(m);
      } catch (e) {
        console.error("[chat handler]", e);
      }
    };

    chat.on("start", () => {
      this.waitingShown = false;
      // Suppress "Connected to live chat" system message.
    });
    chat.on("end", () => {
      // Suppress "Stream ended..." system message; return to silent waiting.
      this.waitingShown = true;
      try {
        chat.stop();
      } catch {}
      this.livechat = null;
    });
    chat.on("error", (e) => {
      // Suppress "Chat error..." system message; return to silent waiting.
      this.waitingShown = true;
      try {
        chat.stop();
      } catch {}
      this.livechat = null;
    });

    chat.on?.("metadata-update", () => ensureAllChat(chat));
    chat.on("chat-update", handle);
    chat.on("actions", handle);

    chat.start();
  }
}

/* -------- Live resolver: choose stream with MOST VIEWERS if multiple -------- */
async function resolveLiveInfo(yt, channelId) {
  // 1) Prefer enumerating the channel's live items and pick the one with the most viewers
  try {
    const channel = await yt.getChannel(channelId);
    let list = [];
    try {
      const liveTab = await channel.getTabByName?.("Live");
      list = liveTab?.videos ?? [];
    } catch {}
    if (!list?.length) list = channel?.videos ?? [];

    // Filter to currently live only
    const lives = (list || []).filter((v) => v?.is_live);

    if (lives.length > 0) {
      // Pick the live with the highest viewer count
      const best = lives.reduce((acc, v) => {
        const vv = liveViewerCount(v);
        const av = liveViewerCount(acc);
        return vv > av ? v : acc;
      });
      const vid = best?.id || best?.video_id;
      if (vid) {
        const info = await yt.getInfo(vid);
        if (info?.getLiveChat?.()) return info;
      }
    }
  } catch {}

  // 2) Fallback: channel /live endpoint (YouTube's default featured live)
  try {
    const info = await yt.getInfo(
      `https://www.youtube.com/channel/${channelId}/live`,
    );
    if (info?.getLiveChat?.()) return info;
  } catch {}

  // 3) Final fallback: first live found anywhere
  try {
    const channel = await yt.getChannel(channelId);
    const list = channel?.videos ?? [];
    const liveItem = (list || []).find((v) => v?.is_live);
    const vid = liveItem?.id || liveItem?.video_id;
    if (vid) return await yt.getInfo(vid);
  } catch {}

  return null;
}

/* Heuristic viewer count extractor for live thumbnails/cards */
function liveViewerCount(v) {
  // Prefer numeric properties if present
  const directNums = [v?.viewers, v?.viewer_count, v?.view_count];
  for (const n of directNums)
    if (typeof n === "number" && isFinite(n)) return n;

  // Check common text fields
  const texts = [
    v?.view_count_text, // may be object or string
    v?.short_view_count_text,
    v?.view_count_short_text,
    v?.watching_count_text,
    v?.inline_badge?.text,
    v?.menu?.label,
  ].flatMap((x) => (x == null ? [] : [x]));

  for (const t of texts) {
    const s = toText(t);
    const n = parseCompactNumber(s);
    if (n >= 0) return n;
  }

  // As a last resort, try parsing any stringified object
  const anyStr = toText(v);
  const rough = parseCompactNumber(anyStr);
  return rough >= 0 ? rough : -1;
}

function toText(x) {
  if (x == null) return "";
  if (typeof x === "string") return x;
  if (typeof x?.text === "string") return x.text;
  if (Array.isArray(x?.runs)) return x.runs.map((r) => r?.text || "").join("");
  if (typeof x?.toString === "function") return x.toString();
  try {
    return JSON.stringify(x);
  } catch {
    return String(x);
  }
}

/* Parse numbers like "12,345 watching", "7.8K", "1.2M watching now" */
function parseCompactNumber(s) {
  if (!s || typeof s !== "string") return -1;
  const m = s.replace(/,/g, "").match(/([\d.]+)\s*([kmb])?/i);
  if (!m) return -1;
  let n = parseFloat(m[1]);
  if (!isFinite(n)) return -1;
  const suf = (m[2] || "").toLowerCase();
  if (suf === "k") n *= 1e3;
  else if (suf === "m") n *= 1e6;
  else if (suf === "b") n *= 1e9;
  return Math.round(n);
}

/* -------- Make sure we're on ALL chat -------- */
function ensureAllChat(chat) {
  const apply = () => {
    try {
      chat.applyFilter?.("LIVE_CHAT");
    } catch {}
  };
  apply();
  setTimeout(apply, 1000);
  setTimeout(apply, 5000);
}

/* ---------------- payload utils ---------------- */
function normalizeActions(evt) {
  if (!evt) return [];
  if (Array.isArray(evt)) return evt;
  if (typeof evt[Symbol.iterator] === "function") return Array.from(evt);
  if (Array.isArray(evt.actions)) return evt.actions;
  if (evt.actions && typeof evt.actions[Symbol.iterator] === "function")
    return Array.from(evt.actions);
  if (evt.action) return [evt.action];
  if (typeof evt === "object" && (evt.type || evt.item || evt.item_type))
    return [evt];
  return [];
}

function parseActions(actions) {
  const out = [];
  for (const act of actions) {
    const t = act?.type || act?.action_type || "";
    if (t && t !== "AddChatItemAction") continue;

    const item = act?.item || act;
    const itype = item?.type || item?.item_type || "";
    if (
      ![
        "LiveChatTextMessage",
        "LiveChatPaidMessage",
        "LiveChatMembershipItem",
      ].includes(itype)
    )
      continue;

    let author =
      item?.author?.name?.toString?.() ??
      item?.author?.name?.text ??
      item?.author_name?.text ??
      item?.authorName ??
      "User";

// Strip leading @ from YouTube handles so overlay shows clean names
if (typeof author === "string") {
  author = author.replace(/^@+/, "");
}

    // Message HTML with emoji <img> (prefer Text#toHTML(), fallback to runs parser)
    const html = textToHtml(
      item?.message ??
        item?.message?.text ??
        item?.header_primary_text ??
        item?.headerPrimaryText ??
        null,
    );

    // Badges
    const badges = item?.author_badges || item?.authorBadges || [];
    const isMod = !!badges.find((b) =>
      (b?.tooltip || b?.label || "").toLowerCase().includes("moderator"),
    );
    const isOwner = !!badges.find((b) =>
      (b?.tooltip || b?.label || "").toLowerCase().includes("owner"),
    );
    const isMember = !!badges.find((b) =>
      (b?.tooltip || b?.label || "").toLowerCase().includes("member"),
    );

    // Collect membership badge image URLs so the overlay can render them
    const member_badges = [];
    for (const b of badges) {
      const tip = (b?.tooltip || b?.label || "").toLowerCase();
      if (!tip.includes("member")) continue;
      const url = pickThumbUrl(
        b?.custom_thumbnail?.thumbnails ||
          b?.thumbnail?.thumbnails ||
          b?.thumbnails ||
          b?.icon?.thumbnails ||
          [],
      );
      if (url) member_badges.push(url);
    }

    out.push({
      type: "chat",
      author,
      html,
      isMod,
      isOwner,
      isMember,
      member_badges,
      rawType: itype,
    });
  }
  return out;
}

function pickThumbUrl(thumbs) {
  if (!Array.isArray(thumbs) || !thumbs.length) return null;
  return thumbs[thumbs.length - 1]?.url || thumbs[0]?.url || null;
}

/* Convert generic Text object (with optional toHTML/runs) into HTML */
function textToHtml(obj) {
  // Prefer Text#toHTML() when available (YouTube emojis render as <img>)
  try {
    if (obj && typeof obj.toHTML === "function") {
      const html = obj.toHTML();
      if (typeof html === "string" && html.trim()) return html;
    }
  } catch {}

  // Fallback: if we have runs, use the custom runs parser
  const runs =
    (obj && (obj.runs || obj.text?.runs)) || (Array.isArray(obj) ? obj : null);

  if (Array.isArray(runs) && runs.length) return runsToHtml(runs);

  // Last resort: stringify safely
  const esc = (s) =>
    String(s).replace(
      /[&<>"']/g,
      (m) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[m],
    );
  if (typeof obj === "string") return esc(obj);
  if (obj != null && typeof obj.toString === "function")
    return esc(obj.toString());
  return "";
}

/* Convert runs (text + custom emoji) to HTML */
function runsToHtml(runs) {
  const esc = (s) =>
    String(s).replace(
      /[&<>"']/g,
      (m) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[m],
    );
  let out = "";
  for (const r of runs || []) {
    if (r?.text != null) {
      out += esc(r.text);
    } else if (r?.emoji) {
      const em = r.emoji;
      const thumbs = em.image?.thumbnails || em.thumbnails || [];
      const src = thumbs[thumbs.length - 1]?.url || thumbs[0]?.url || "";
      const alt = em.shortcuts?.[0] || em.label || "emoji";
      if (src) {
        const s = esc(src),
          a = esc(alt);
        out += `<img class="yt-emoji emoji" src="${s}" data-src="${s}" alt="${a}" />`;
      } else {
        out += esc(alt);
      }
    }
  }
  return out;
}

/* ---------------- ws ---------------- */
wss.on("connection", async (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const channelId = url.searchParams.get("channelId");
  if (!channelId) {
    // Suppress "Missing channelId" system message; close silently.
    ws.close();
    return;
  }

  // --- use lazy/resilient YT init ---
  const yt = await getYT();
  if (!yt) {
    // could not init YT client; close this connection gracefully
    try { ws.close(); } catch {}
    return;
  }

  let mgr = managers.get(channelId);
  if (!mgr) {
    mgr = new ChatManager(channelId, yt);
    managers.set(channelId, mgr);
    mgr.start().catch(() => {});
  }
  mgr.addClient(ws);
  // Suppress "Connecting…" system message.
});

// Some hosts require explicit 0.0.0.0 binding.
httpServer.listen(PORT, "0.0.0.0", () =>
  console.log(`✅ Server running at http://0.0.0.0:${PORT}`),
);

process.on("unhandledRejection", (e) =>
  console.error("[unhandledRejection]", e),
);
process.on("uncaughtException", (e) => console.error("[uncaughtException]", e));
