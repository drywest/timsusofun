// server.js
import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import { fileURLToPath } from "url";
import path from "path";

// Render can run older Node versions unless you pin Node 18+. Polyfill fetch for Node < 18.
let __fetch = globalThis.fetch;
if (!__fetch) {
  try {
    const mod = await import("node-fetch");
    __fetch = mod.default;
  } catch (e) {
    console.error("Global fetch is not available. Use Node 18+ or install node-fetch.", e);
  }
}
const fetch = (...args) => {
  if (!__fetch) throw new Error("fetch is not available. Use Node 18+ or install node-fetch.");
  return __fetch(...args);
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 8787);

const app = express();
const publicDir = path.join(__dirname, "public");

app.use(express.static(publicDir));

app.get("/", (req, res) => res.sendFile(path.join(publicDir, "setup.html")));
app.get("/setup", (req, res) => res.sendFile(path.join(publicDir, "setup.html")));
app.get("/overlay", (req, res) => res.sendFile(path.join(publicDir, "overlay.html")));
app.get("/overlay/:channelId", (req, res) => res.sendFile(path.join(publicDir, "overlay.html")));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

const streams = new Map();

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowMs = () => Date.now();
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

function safeJsonParse(s) {
  try {
    return JSON.parse(s);
  } catch {}
  return null;
}

function findJsonObject(text, startIndex) {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = startIndex; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    if (depth === 0 && i > startIndex) {
      return text.slice(startIndex, i + 1);
    }
  }
  return null;
}

function extractYtCfg(html) {
  const m = html.match(/ytcfg\.set\((\{[\s\S]*?\})\);/);
  if (m) return safeJsonParse(m[1]);

  const idx = html.indexOf("ytcfg.set(");
  if (idx !== -1) {
    const start = html.indexOf("{", idx);
    if (start !== -1) {
      const obj = findJsonObject(html, start);
      if (obj) return safeJsonParse(obj);
    }
  }
  return null;
}

function extractYtInitialData(html) {
  const m = html.match(/var ytInitialData = (\{[\s\S]*?\});/);
  if (m) return safeJsonParse(m[1]);

  const idx = html.indexOf("ytInitialData");
  if (idx !== -1) {
    const start = html.indexOf("{", idx);
    if (start !== -1) {
      const obj = findJsonObject(html, start);
      if (obj) return safeJsonParse(obj);
    }
  }
  return null;
}

function extractYtInitialPlayerResponse(html) {
  const m = html.match(/var ytInitialPlayerResponse = (\{[\s\S]*?\});/);
  if (m) return safeJsonParse(m[1]);

  const idx = html.indexOf("ytInitialPlayerResponse");
  if (idx !== -1) {
    const start = html.indexOf("{", idx);
    if (start !== -1) {
      const obj = findJsonObject(html, start);
      if (obj) return safeJsonParse(obj);
    }
  }
  return null;
}

function getContinuationToken(item) {
  const c1 = item?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
  if (typeof c1 === "string" && c1) return c1;
  const c2 = item?.continuationEndpoint?.continuationCommand?.token;
  if (typeof c2 === "string" && c2) return c2;
  const c3 = item?.serviceEndpoint?.continuationCommand?.token;
  if (typeof c3 === "string" && c3) return c3;
  return null;
}

function pickLiveChatContinuation(items) {
  if (!Array.isArray(items) || items.length === 0) return null;

  const lowered = items.map((it) => ({ it, title: String(it?.title || "").toLowerCase() }));
  const live = lowered.find((x) => x.title === "live chat") || lowered.find((x) => x.title.includes("live chat"));
  if (live) {
    const t = getContinuationToken(live.it);
    if (t) return t;
  }

  for (const it of items) {
    const t = getContinuationToken(it);
    if (t) return t;
  }
  return null;
}

function walkFindTabs(obj) {
  const out = [];
  const stack = [obj];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") continue;

    if (Array.isArray(cur)) {
      for (const v of cur) stack.push(v);
      continue;
    }

    if (cur?.tabRenderer) out.push(cur.tabRenderer);

    for (const v of Object.values(cur)) stack.push(v);
  }
  return out;
}

function findWatchContents(initialData) {
  const contents = initialData?.contents?.twoColumnWatchNextResults?.conversationBar?.liveChatRenderer;
  if (contents) return contents;

  const tabs = walkFindTabs(initialData);
  for (const t of tabs) {
    const c = t?.content?.liveChatRenderer;
    if (c) return c;
  }
  return null;
}

function pickInitialContinuation(initialData) {
  const chat = findWatchContents(initialData);
  if (!chat) return null;

  const conts = chat?.continuations;
  if (Array.isArray(conts) && conts.length) {
    for (const c of conts) {
      const token =
        c?.reloadContinuationData?.continuation ||
        c?.invalidationContinuationData?.continuation ||
        c?.timedContinuationData?.continuation;
      if (token) return token;
    }
  }

  const items = chat?.header?.liveChatHeaderRenderer?.viewSelector?.sortFilterSubMenuRenderer?.subMenuItems;
  const tok = pickLiveChatContinuation(items);
  if (tok) return tok;

  const actions = chat?.actions;
  if (Array.isArray(actions)) {
    for (const a of actions) {
      const token = a?.addChatItemAction?.item?.liveChatTextMessageRenderer?.contextMenuEndpoint?.continuationCommand
        ?.token;
      if (token) return token;
    }
  }

  return null;
}

function findValueInTree(obj, predicate) {
  const stack = [obj];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") continue;
    if (predicate(cur)) return cur;

    if (Array.isArray(cur)) {
      for (const v of cur) stack.push(v);
    } else {
      for (const v of Object.values(cur)) stack.push(v);
    }
  }
  return null;
}

function getLiveChatContinuationFromBrowse(initialData) {
  const sec = findValueInTree(initialData, (x) => x?.liveChatRenderer);
  const liveChatRenderer = sec?.liveChatRenderer || initialData?.liveChatRenderer;
  if (!liveChatRenderer) return null;

  const items = liveChatRenderer?.header?.liveChatHeaderRenderer?.viewSelector?.sortFilterSubMenuRenderer?.subMenuItems;
  return pickLiveChatContinuation(items);
}

function pickVideoIdFromHtml(text) {
  const m = text.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
  return m ? m[1] : null;
}

function bestThumb(thumbnails) {
  if (!Array.isArray(thumbnails) || thumbnails.length === 0) return null;
  const sorted = [...thumbnails].sort((a, b) => (a?.width || 0) - (b?.width || 0));
  return sorted[sorted.length - 1]?.url || sorted[0]?.url || null;
}

function parseBadges(authorBadges) {
  const out = { isModerator: false, isOwner: false, isVerified: false, icons: [] };
  if (!Array.isArray(authorBadges)) return out;

  for (const b of authorBadges) {
    const r = b?.liveChatAuthorBadgeRenderer;
    const iconType = r?.icon?.iconType;
    const tooltip = String(r?.tooltip || "").toLowerCase();

    if (iconType === "MODERATOR" || tooltip.includes("moderator")) out.isModerator = true;
    if (iconType === "OWNER" || tooltip.includes("owner")) out.isOwner = true;
    if (iconType === "VERIFIED" || tooltip.includes("verified")) out.isVerified = true;

    const url = bestThumb(r?.customThumbnail?.thumbnails);
    if (url) out.icons.push(url);
  }

  return out;
}

function textRunsToString(runs) {
  if (!Array.isArray(runs)) return "";
  return runs.map((r) => r?.text || "").join("");
}

function parseChatItem(item) {
  const m = item?.addChatItemAction?.item?.liveChatTextMessageRenderer;
  if (!m) return null;

  const authorName = m?.authorName?.simpleText || "";
  const msgText = textRunsToString(m?.message?.runs || []);
  const ts = Number(m?.timestampUsec || 0);
  const badges = parseBadges(m?.authorBadges);

  const photo = bestThumb(m?.authorPhoto?.thumbnails) || null;
  const id = m?.id || null;

  return {
    id,
    author: {
      name: authorName,
      photo,
      isModerator: badges.isModerator,
      isOwner: badges.isOwner,
      isVerified: badges.isVerified,
      badges: badges.icons
    },
    message: msgText,
    timestampUsec: ts
  };
}

function nextContinuationAndTimeout(data) {
  const cont = data?.continuationContents?.liveChatContinuation;
  const continuations = cont?.continuations;
  if (!Array.isArray(continuations) || continuations.length === 0) return { continuation: null, timeoutMs: 900 };

  for (const c of continuations) {
    const inv = c?.invalidationContinuationData;
    if (inv?.continuation) return { continuation: inv.continuation, timeoutMs: Number(inv?.timeoutMs || 900) };
    const timed = c?.timedContinuationData;
    if (timed?.continuation) return { continuation: timed.continuation, timeoutMs: Number(timed?.timeoutMs || 900) };
    const reload = c?.reloadContinuationData;
    if (reload?.continuation) return { continuation: reload.continuation, timeoutMs: Number(reload?.timeoutMs || 900) };
  }

  return { continuation: null, timeoutMs: 900 };
}

async function fetchText(url) {
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent": UA,
      "Accept-Language": "en-US,en;q=0.9",
      "Cookie": "CONSENT=YES+; PREF=hl=en&gl=US"
    }
  });
  const text = await res.text();
  return { url: res.url, status: res.status, text };
}

async function isLiveNow(videoId) {
  const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=en&gl=US`;
  const { text } = await fetchText(watchUrl);
  const pr = extractYtInitialPlayerResponse(text);
  if (!pr) return false;

  const lbd = pr?.microformat?.playerMicroformatRenderer?.liveBroadcastDetails;
  if (typeof lbd?.isLiveNow === "boolean") return lbd.isLiveNow === true;

  const isLiveContent = pr?.videoDetails?.isLiveContent === true;
  if (!isLiveContent) return false;

  const status = pr?.playabilityStatus?.status;
  return status === "OK";
}

async function getCandidateFromChannel({ channelId, handle }) {
  const target = handle
    ? `https://www.youtube.com/${encodeURIComponent(handle)}/live?hl=en&gl=US`
    : channelId
      ? `https://www.youtube.com/channel/${encodeURIComponent(channelId)}/live?hl=en&gl=US`
      : null;

  if (!target) return null;

  const { url, text } = await fetchText(target);

  try {
    const u = new URL(url);
    const v = u.searchParams.get("v");
    if (v) return v;
  } catch {}

  const m1 = text.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
  if (m1) return m1[1];

  return pickVideoIdFromHtml(text);
}

async function initLiveChat(liveId) {
  const chatUrl = `https://www.youtube.com/live_chat?is_popout=1&v=${encodeURIComponent(liveId)}&hl=en&gl=US`;
  const { text } = await fetchText(chatUrl);

  const ytcfg = extractYtCfg(text);
  const initialData = extractYtInitialData(text);

  if (!ytcfg || !initialData) return { ok: false, reason: "Failed to read YouTube chat data." };

  const apiKey = ytcfg.INNERTUBE_API_KEY;
  const context = ytcfg.INNERTUBE_CONTEXT || null;
  if (!apiKey || !context) return { ok: false, reason: "Missing InnerTube config." };

  const continuation = pickInitialContinuation(initialData);
  if (!continuation) return { ok: false, reason: "No Live chat continuation found." };

  const client = context?.client || {};
  const clientName = client?.clientName || "WEB";
  const clientVersion = client?.clientVersion || ytcfg?.INNERTUBE_CLIENT_VERSION || "2.20240201.01.00";

  return { ok: true, apiKey, context, continuation, clientName, clientVersion };
}

async function waitForLiveId({ channelId, handle }) {
  let backoff = 800;
  for (;;) {
    const cand = await getCandidateFromChannel({ channelId, handle }).catch(() => null);
    if (cand) {
      const ok = await isLiveNow(cand).catch(() => false);
      if (ok) return cand;
    }
    await sleep(backoff);
    backoff = Math.min(4000, Math.floor(backoff * 1.2));
  }
}

class ChatStream {
  constructor(key) {
    this.liveId = key;
    this.clients = new Set();
    this.running = false;
    this.stopping = false;
    this.seenIds = new Map();
  }

  addClient(ws) {
    this.clients.add(ws);
    ws.on("close", () => {
      this.clients.delete(ws);
      if (this.clients.size === 0) this.stop();
    });
  }

  send(type, data) {
    const payload = JSON.stringify({ type, data });
    for (const ws of this.clients) {
      if (ws.readyState === ws.OPEN) ws.send(payload);
    }
  }

  stop() {
    this.stopping = true;
  }

  markSeen(id) {
    if (!id) return false;
    if (this.seenIds.has(id)) return true;

    this.seenIds.set(id, nowMs());
    if (this.seenIds.size > 7000) {
      const entries = [...this.seenIds.entries()].sort((a, b) => a[1] - b[1]);
      for (let i = 0; i < 2000 && i < entries.length; i++) {
        const [k] = entries[i];
        if (k) this.seenIds.delete(k);
      }
    }
    return false;
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this.stopping = false;

    const init = await initLiveChat(this.liveId);
    if (!init.ok) {
      this.send("error", { message: init.reason || "Init failed." });
      this.running = false;
      return;
    }

    const apiUrl = `https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?key=${encodeURIComponent(init.apiKey)}`;

    let continuation = init.continuation;
    let backoff = 120;
    let lastErrSent = 0;

    while (!this.stopping && this.clients.size > 0) {
      try {
        const res = await fetch(apiUrl, {
          method: "POST",
          headers: {
            "User-Agent": UA,
            "Accept-Language": "en-US,en;q=0.9",
            "Cookie": "CONSENT=YES+; PREF=hl=en&gl=US",
            "Content-Type": "application/json",
            "x-youtube-client-name": String(init.clientName),
            "x-youtube-client-version": String(init.clientVersion)
          },
          body: JSON.stringify({ context: init.context, continuation })
        });

        const json = await res.json().catch(() => null);
        if (!json) throw new Error("Bad response");

        const actions = json?.continuationContents?.liveChatContinuation?.actions;
        let pushed = 0;

        if (Array.isArray(actions)) {
          for (const a of actions) {
            const item = a?.addChatItemAction?.item;
            const chat = parseChatItem(item);
            if (!chat) continue;
            if (chat.id && this.markSeen(chat.id)) continue;
            this.send("chat", chat);
            pushed++;
          }
        }

        const nxt = nextContinuationAndTimeout(json);
        if (!nxt.continuation) throw new Error("No continuation");
        continuation = nxt.continuation;

        const t = Number(nxt.timeoutMs || 900);
        let waitMs = clamp(Math.floor(t * 0.28), 60, 240);
        if (pushed > 0) waitMs = 60;

        backoff = 120;
        await sleep(waitMs);
      } catch (err) {
        const now = nowMs();
        if (now - lastErrSent > 5000) {
          lastErrSent = now;
          this.send("error", { message: "Chat fetch error.", details: err?.message ? String(err.message) : String(err) });
        }
        await sleep(backoff);
        backoff = Math.min(1500, Math.floor(backoff * 1.25));
      }
    }

    this.running = false;
  }
}

wss.on("connection", async (ws, req) => {
  const url = new URL(req.url, "http://localhost");
  const channelId = url.searchParams.get("channelId") || "";
  const liveIdIn = url.searchParams.get("liveId") || url.searchParams.get("videoId") || "";
  const handleIn = url.searchParams.get("handle") || "";

  let handle = handleIn;
  if (!handle && channelId && channelId.startsWith("@")) handle = channelId;

  let liveId = liveIdIn;

  try {
    if (!liveId) {
      liveId = await waitForLiveId({ channelId: channelId || "", handle: handle || "" });
    } else {
      while (!(await isLiveNow(liveId).catch(() => false))) {
        await sleep(2500);
      }
    }

    if (!streams.has(liveId)) {
      const s = new ChatStream(liveId);
      streams.set(liveId, s);
      s.start().finally(() => streams.delete(liveId));
    }

    streams.get(liveId).addClient(ws);
  } catch (err) {
    ws.send(JSON.stringify({
      type: "error",
      data: { message: "Failed to connect to YouTube chat.", details: err?.message ? String(err.message) : String(err) }
    }));
    ws.close();
  }
});

server.listen(PORT, () => {
  console.log(`http://localhost:${PORT}/`);
});
