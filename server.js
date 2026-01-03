// server.js
import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import { fileURLToPath } from "url";
import path from "path";
import { fetch as undiciFetch, Agent } from "undici";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 8787);

const app = express();
app.set("trust proxy", true);

const publicDir = path.join(__dirname, "public");

// Static files
app.use(express.static(publicDir));
app.get("/", (req, res) => res.sendFile(path.join(publicDir, "index.html")));

// Permanent overlay route: /overlay/<channelIdOrHandle>
app.get("/overlay/:channelId", (req, res) =>
  res.sendFile(path.join(publicDir, "overlay.html"))
);

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

// Keep WS alive behind proxies (Render)
const PING_MS = 25_000;
const pingInterval = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      try { ws.terminate(); } catch {}
      continue;
    }
    ws.isAlive = false;
    try { ws.ping(); } catch {}
  }
}, PING_MS);

wss.on("close", () => clearInterval(pingInterval));

const streams = new Map();

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowMs = () => Date.now();
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));

// Force IPv4 (helps on some hosts)
const dispatcher = new Agent({
  connect: { family: 4, timeout: 30_000 },
});

async function fetchWithTimeout(url, opts = {}, timeoutMs = 25_000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);

  try {
    return await undiciFetch(url, {
      ...opts,
      dispatcher,
      signal: ac.signal,
      redirect: "follow",
    });
  } finally {
    clearTimeout(t);
  }
}

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

function findMatchingBrace(text, startIndex) {
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
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    if (depth === 0) return i;
  }
  return -1;
}

function extractJsonObjectAfter(html, marker) {
  const idx = html.indexOf(marker);
  if (idx === -1) return null;
  const braceStart = html.indexOf("{", idx);
  if (braceStart === -1) return null;
  const braceEnd = findMatchingBrace(html, braceStart);
  if (braceEnd === -1) return null;
  return safeJsonParse(html.slice(braceStart, braceEnd + 1));
}

function extractYtCfg(html) {
  const obj = extractJsonObjectAfter(html, "ytcfg.set(");
  if (obj) return obj;
  const mKey = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
  const mVer = html.match(/"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/);
  const mName = html.match(/"INNERTUBE_CONTEXT_CLIENT_NAME":(\d+)/);
  const mContext = extractJsonObjectAfter(html, '"INNERTUBE_CONTEXT":');
  if (!mKey || !mVer || !mName || !mContext) return null;
  return {
    INNERTUBE_API_KEY: mKey[1],
    INNERTUBE_CONTEXT_CLIENT_VERSION: mVer[1],
    INNERTUBE_CONTEXT_CLIENT_NAME: Number(mName[1]),
    INNERTUBE_CONTEXT: mContext,
  };
}

function extractYtInitialData(html) {
  const markers = ["var ytInitialData = ", 'window["ytInitialData"] = ', "ytInitialData = "];
  for (const marker of markers) {
    const idx = html.indexOf(marker);
    if (idx === -1) continue;
    const braceStart = html.indexOf("{", idx);
    if (braceStart === -1) continue;
    const braceEnd = findMatchingBrace(html, braceStart);
    if (braceEnd === -1) continue;
    const obj = safeJsonParse(html.slice(braceStart, braceEnd + 1));
    if (obj) return obj;
  }
  return null;
}

function extractYtInitialPlayerResponse(html) {
  const markers = [
    "var ytInitialPlayerResponse = ",
    "ytInitialPlayerResponse = ",
    'window["ytInitialPlayerResponse"] = ',
  ];
  for (const marker of markers) {
    const idx = html.indexOf(marker);
    if (idx === -1) continue;
    const braceStart = html.indexOf("{", idx);
    if (braceStart === -1) continue;
    const braceEnd = findMatchingBrace(html, braceStart);
    if (braceEnd === -1) continue;
    const obj = safeJsonParse(html.slice(braceStart, braceEnd + 1));
    if (obj) return obj;
  }
  return null;
}

function deepFind(obj, predicate) {
  const stack = [obj];
  const seen = new Set();
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") continue;
    if (seen.has(cur)) continue;
    seen.add(cur);
    if (predicate(cur)) return cur;
    if (Array.isArray(cur)) {
      for (let i = cur.length - 1; i >= 0; i--) stack.push(cur[i]);
    } else {
      const vals = Object.values(cur);
      for (let i = vals.length - 1; i >= 0; i--) stack.push(vals[i]);
    }
  }
  return null;
}

function getContinuationToken(item) {
  const c1 = item?.continuation?.reloadContinuationData?.continuation;
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

  const topIdx = lowered.findIndex((x) => x.title.includes("top chat"));
  if (topIdx !== -1 && lowered.length >= 2) {
    const other = lowered.find((_, idx) => idx !== topIdx);
    const t = getContinuationToken(other?.it);
    if (t) return t;
  }

  const selectedIdx = items.findIndex((it) => it?.selected === true);
  if (selectedIdx !== -1 && items.length >= 2) {
    const other = items.find((_, idx) => idx !== selectedIdx);
    const t = getContinuationToken(other);
    if (t) return t;
  }

  for (let i = items.length - 1; i >= 0; i--) {
    const t = getContinuationToken(items[i]);
    if (t) return t;
  }
  return null;
}

function pickInitialContinuation(initialData) {
  const liveChatRendererObj = deepFind(initialData, (o) => !!o?.liveChatRenderer);
  const liveChatRenderer = liveChatRendererObj?.liveChatRenderer || initialData?.contents?.liveChatRenderer || null;
  if (!liveChatRenderer) return null;

  const menu = deepFind(liveChatRenderer, (o) => Array.isArray(o?.sortFilterSubMenuRenderer?.subMenuItems));
  const items = menu?.sortFilterSubMenuRenderer?.subMenuItems;
  const contFromMenu = pickLiveChatContinuation(items);
  if (contFromMenu) return contFromMenu;

  const contA = liveChatRenderer?.continuations?.[0]?.reloadContinuationData?.continuation;
  if (typeof contA === "string" && contA) return contA;

  const contB = liveChatRenderer?.continuations?.[0]?.timedContinuationData?.continuation;
  if (typeof contB === "string" && contB) return contB;

  return null;
}

function bestThumb(thumbnails) {
  if (!Array.isArray(thumbnails) || thumbnails.length === 0) return null;
  const sorted = [...thumbnails].sort((a, b) => (a?.width || 0) - (b?.width || 0));
  return sorted[sorted.length - 1]?.url || sorted[0]?.url || null;
}

function parseBadges(authorBadges) {
  const out = { isModerator: false, isVerified: false, isOwner: false, membership: null };
  if (!Array.isArray(authorBadges)) return out;

  for (const b of authorBadges) {
    const r = b?.liveChatAuthorBadgeRenderer;
    if (!r) continue;

    const tooltipRaw = r?.tooltip || r?.accessibility?.accessibilityData?.label || "";
    const tooltip = String(tooltipRaw).toLowerCase();
    const iconType = String(r?.icon?.iconType || "").toLowerCase();
    const thumbUrl = bestThumb(r?.customThumbnail?.thumbnails);
    const label = tooltipRaw || "";

    const isMod = tooltip.includes("moderator") || iconType.includes("moderator") || iconType.includes("mod");
    const isOwner = tooltip.includes("owner") || tooltip.includes("channel owner") || iconType.includes("owner") || iconType.includes("author");
    const isVerified = tooltip.includes("verified") || iconType.includes("verified") || iconType.includes("check_circle") || iconType.includes("verified_channel");

    if (isMod) out.isModerator = true;
    if (isOwner) out.isOwner = true;
    if (isVerified) out.isVerified = true;

    if (!out.membership && thumbUrl && !isMod && !isOwner && !isVerified) {
      out.membership = { url: thumbUrl, alt: label || "Member" };
    }
  }
  return out;
}

function parseRuns(message) {
  const runs = message?.runs;
  if (!Array.isArray(runs)) return [];
  const out = [];
  for (const r of runs) {
    if (typeof r?.text === "string") {
      out.push({ type: "text", text: r.text });
      continue;
    }
    const e = r?.emoji;
    if (e) {
      const url = bestThumb(e?.image?.thumbnails) || null;
      const alt =
        e?.shortcuts?.[0] ||
        e?.emojiId ||
        e?.image?.accessibility?.accessibilityData?.label ||
        "";
      out.push({ type: "emoji", url, alt });
    }
  }
  return out;
}

function parseTextMessageRenderer(r) {
  const id = r?.id || null;
  const authorName = r?.authorName?.simpleText || "";
  const channelId = r?.authorExternalChannelId || "";
  const badges = parseBadges(r?.authorBadges);
  const message = parseRuns(r?.message);

  const ts = Number(r?.timestampUsec || 0);
  const timestamp = ts ? Math.floor(ts / 1000) : nowMs();

  return { kind: "text", id, author: { name: authorName, channelId }, badges, message, timestamp };
}

function extractChatItemFromAction(action) {
  const add = action?.addChatItemAction;
  if (add?.item) return add.item;

  const replay = action?.replayChatItemAction?.actions;
  if (Array.isArray(replay)) {
    for (const a of replay) {
      const it = a?.addChatItemAction?.item;
      if (it) return it;
    }
  }
  return null;
}

function parseChatItem(item) {
  const rText = item?.liveChatTextMessageRenderer;
  if (rText) return parseTextMessageRenderer(rText);
  return null;
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

const commonHeaders = {
  "User-Agent": UA,
  "Accept-Language": "en-US,en;q=0.9",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Cache-Control": "no-cache",
  "Pragma": "no-cache",
  "Cookie": "CONSENT=YES+; PREF=hl=en&gl=US",
  "Referer": "https://www.youtube.com/",
};

async function fetchText(url) {
  const res = await fetchWithTimeout(url, { headers: commonHeaders }, 25_000);
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

  const m2 = text.match(/\/watch\?v=([a-zA-Z0-9_-]{11})/);
  if (m2) return m2[1];

  return null;
}

async function waitForLiveId({ channelId, handle }) {
  while (true) {
    const cand = await getCandidateFromChannel({ channelId, handle });
    if (cand) {
      const live = await isLiveNow(cand).catch(() => false);
      if (live) return cand;
    }
    await sleep(2500);
  }
}

async function initLiveChat(liveId) {
  const chatUrl = `https://www.youtube.com/live_chat?is_popout=1&v=${encodeURIComponent(liveId)}&hl=en&gl=US`;
  const { text } = await fetchText(chatUrl);

  const ytcfg = extractYtCfg(text);
  const initialData = extractYtInitialData(text);

  if (!ytcfg || !initialData) return { ok: false, reason: "Failed to read YouTube chat data (blocked/changed HTML)." };

  const apiKey = ytcfg.INNERTUBE_API_KEY;
  const context = ytcfg.INNERTUBE_CONTEXT || null;
  if (!apiKey || !context) return { ok: false, reason: "Missing InnerTube config." };

  const continuation = pickInitialContinuation(initialData);
  if (!continuation) return { ok: false, reason: "No live chat continuation found." };

  const clientName = ytcfg.INNERTUBE_CONTEXT_CLIENT_NAME || 1;
  const clientVersion = ytcfg.INNERTUBE_CONTEXT_CLIENT_VERSION || context?.client?.clientVersion || "";

  return { ok: true, apiKey, context, continuation, clientName, clientVersion, chatUrl };
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

  stop() { this.stopping = true; }

  markSeen(id) {
    if (!id) return false;
    if (this.seenIds.has(id)) return true;
    this.seenIds.set(id, nowMs());
    if (this.seenIds.size > 7000) {
      const entries = [...this.seenIds.entries()].sort((a, b) => a[1] - b[1]);
      for (let i = 0; i < 2600; i++) {
        const k = entries[i]?.[0];
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

    const apiUrl =
      `https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?key=${encodeURIComponent(init.apiKey)}`;

    let continuation = init.continuation;
    let backoff = 140;

    while (!this.stopping && this.clients.size > 0) {
      try {
        const res = await fetchWithTimeout(
          apiUrl,
          {
            method: "POST",
            headers: {
              "User-Agent": UA,
              "Accept-Language": "en-US,en;q=0.9",
              "Cookie": "CONSENT=YES+; PREF=hl=en&gl=US",
              "Content-Type": "application/json",
              "x-youtube-client-name": String(init.clientName),
              "x-youtube-client-version": String(init.clientVersion),
              "Origin": "https://www.youtube.com",
              "Referer": init.chatUrl,
            },
            body: JSON.stringify({ context: init.context, continuation }),
          },
          25_000
        );

        const json = await res.json().catch(() => null);
        if (!json) throw new Error("Bad response");

        const actions = json?.continuationContents?.liveChatContinuation?.actions;
        let pushed = 0;

        if (Array.isArray(actions)) {
          for (const a of actions) {
            const item = extractChatItemFromAction(a);
            if (!item) continue;
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

        backoff = 140;
        await sleep(waitMs);
      } catch {
        await sleep(backoff);
        backoff = Math.min(2000, Math.floor(backoff * 1.25));
      }
    }

    this.running = false;
  }
}

wss.on("connection", async (ws, req) => {
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });

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
  } catch {
    ws.send(JSON.stringify({ type: "error", data: { message: "Failed to connect to YouTube chat." } }));
    try { ws.close(); } catch {}
  }
});

server.listen(PORT, () => {
  console.log(`Listening on port ${PORT}`);
});
