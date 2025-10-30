// server.js
import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import { readFile } from "fs/promises"; // added for injecting audio
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

// ✅ Serve cooked.mp3 from root (not public)
app.get("/cooked.mp3", (_req, res) =>
  res.sendFile(path.join(__dirname, "cooked.mp3"))
);

// ✅ Inject autoplay sound ONLY for this specific channel overlay
app.get("/overlay/:channelId", async (req, res) => {
  const { channelId } = req.params;
  if (channelId === "UC7c8wbA9yQjzxkj2uyrHrkg") {
    try {
      const htmlPath = path.join(__dirname, "public", "overlay.html");
      let html = await readFile(htmlPath, "utf8");
      const injection = `
<!-- Autoplay cooked.mp3 once -->
<audio id="once-audio" src="/cooked.mp3" autoplay></audio>
<script>
  (function(){
    const audio = document.getElementById("once-audio");
    if(audio){
      audio.addEventListener("ended", () => audio.remove(), { once: true });
    }
  })();
</script>
`;
      html = html.replace("</body>", `${injection}</body>`);
      res.type("html").send(html);
      return;
    } catch (err) {
      console.error("Audio inject failed:", err);
    }
  }
  // default overlay for all others
  res.sendFile(path.join(__dirname, "public", "overlay.html"));
});

const PORT = process.env.PORT || 3000;
const YT_READY = Innertube.create({ cache: new UniversalCache(true) });

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
    this.outQueue = [];
    this.flushTimer = null;
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
    try { this.livechat?.stop(); } catch {}
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
      if (!this.waitingShown) this.waitingShown = true;
    } finally {
      this.timer = setTimeout(() => this.loop(), 800);
    }
  }

  async attach() {
    const info = await resolveLiveInfo(this.yt, this.channelId);
    if (!info) throw new Error("No live found");
    const chat = info.getLiveChat?.();
    if (!chat) throw new Error("Live chat not available");

    this.videoId = info?.basic_info?.id || info?.id || null;
    this.livechat = chat;
    this.waitingShown = false;
    ensureAllChat(chat);

    try {
      if (chat.smoothed_queue) {
        chat.smoothed_queue.setEnabled?.(false);
        chat.smoothed_queue.enabled = false;
        chat.smoothed_queue.setEmitDelay?.(0);
        chat.smoothed_queue.setMaxBatchSize?.(1);
        const directEmit = (arr) => {
          try { chat.emit?.("actions", arr); } catch {}
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

    chat.on("start", () => { this.waitingShown = false; });
    chat.on("end", () => {
      this.waitingShown = true;
      try { chat.stop(); } catch {}
      this.livechat = null;
    });
    chat.on("error", () => {
      this.waitingShown = true;
      try { chat.stop(); } catch {}
      this.livechat = null;
    });

    chat.on?.("metadata-update", () => ensureAllChat(chat));
    chat.on("chat-update", handle);
    chat.on("actions", handle);

    chat.start();
  }
}

async function resolveLiveInfo(yt, channelId) {
  try {
    const channel = await yt.getChannel(channelId);
    let list = [];
    try {
      const liveTab = await channel.getTabByName?.("Live");
      list = liveTab?.videos ?? [];
    } catch {}
    if (!list?.length) list = channel?.videos ?? [];
    const lives = (list || []).filter((v) => v?.is_live);
    if (lives.length > 0) {
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
  try {
    const info = await yt.getInfo(
      `https://www.youtube.com/channel/${channelId}/live`
    );
    if (info?.getLiveChat?.()) return info;
  } catch {}
  try {
    const channel = await yt.getChannel(channelId);
    const list = channel?.videos ?? [];
    const liveItem = (list || []).find((v) => v?.is_live);
    const vid = liveItem?.id || liveItem?.video_id;
    if (vid) return await yt.getInfo(vid);
  } catch {}
  return null;
}

function liveViewerCount(v) {
  const directNums = [v?.viewers, v?.viewer_count, v?.view_count];
  for (const n of directNums) if (typeof n === "number" && isFinite(n)) return n;
  const texts = [
    v?.view_count_text, v?.short_view_count_text, v?.view_count_short_text,
    v?.watching_count_text, v?.inline_badge?.text, v?.menu?.label,
  ].flatMap((x) => (x == null ? [] : [x]));
  for (const t of texts) {
    const s = toText(t);
    const n = parseCompactNumber(s);
    if (n >= 0) return n;
  }
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
  try { return JSON.stringify(x); } catch { return String(x); }
}

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

function ensureAllChat(chat) {
  const apply = () => { try { chat.applyFilter?.("LIVE_CHAT"); } catch {} };
  apply();
  setTimeout(apply, 1000);
  setTimeout(apply, 5000);
}

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

// unchanged rest of your code…
