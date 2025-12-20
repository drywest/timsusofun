// public/overlay.js
(function () {
  const stack = document.getElementById("stack");

  // Tuning: ?fs=36&keep=600&hype=<url>&cid=<channelId>&elephant=1
  const params = new URLSearchParams(location.search);
  const fontSize = parseInt(params.get("fs") || "36", 10);
  const keepParam = params.get("keep");
  const elephantEnabled = params.get("elephant") === "1"; // OFF by default

  document.documentElement.style.setProperty("--font-size", `${fontSize}px`);
  if (keepParam) {
    document.documentElement.style.setProperty("--max-keep", parseInt(keepParam, 10));
  }

  // ---- Robust channelId resolution ----
  function looksLikeChannelId(s) {
    return typeof s === "string" && /^UC[a-zA-Z0-9_-]{22}$/.test(s);
  }

  function getChannelId() {
    const q = params.get("cid") || params.get("channelId") || params.get("id");
    if (q) return decodeURIComponent(q);

    const segs = location.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    for (const s of segs) if (looksLikeChannelId(s)) return s;

    const last = segs[segs.length - 1];
    if (looksLikeChannelId(last)) return last;

    return null;
  }

  const channelId = getChannelId();

  if (!channelId || !looksLikeChannelId(channelId)) {
    console.error(
      "[overlay] Missing/invalid channelId.\n" +
        "Use:\n" +
        "  https://YOURDOMAIN/<CHANNEL_ID>\n" +
        "or\n" +
        "  https://YOURDOMAIN/overlay.html?cid=<CHANNEL_ID>\n",
      { pathname: location.pathname, search: location.search },
    );
    return;
  }

  console.log("[overlay] channelId =", channelId);

  // ---- WebSocket connect / fallback params / heartbeat ----
  const wsProtocol = location.protocol === "https:" ? "wss:" : "ws:";
  const wsBase = wsProtocol + "//" + location.host;

  // Many servers differ on param name. We'll try several automatically.
  const wsUrlBuilders = [
    (id) => `/ws?cid=${encodeURIComponent(id)}`,
    (id) => `/ws?channelId=${encodeURIComponent(id)}`,
    (id) => `/ws?id=${encodeURIComponent(id)}`,
    (id) => `/ws?c=${encodeURIComponent(id)}`,
  ];

  let ws = null;
  let reconnectAttempts = 0;
  let reconnectTimer = null;
  let heartbeatTimer = null;

  let builderIndex = 0;
  let openedAt = 0;

  function clearHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function startHeartbeat() {
    clearHeartbeat();
    // Send something periodically so proxies/servers don't drop "idle" sockets.
    heartbeatTimer = setInterval(() => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      try {
        ws.send(JSON.stringify({ type: "ping", t: Date.now() }));
      } catch {}
    }, 25000);
  }

  function sendSubscribe() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    // Send a "hello/subscribe" message that covers common server expectations.
    const payloads = [
      { type: "subscribe", cid: channelId },
      { type: "subscribe", channelId },
      { type: "subscribe", id: channelId },
      { type: "hello", cid: channelId },
      { type: "hello", channelId },
    ];
    for (const p of payloads) {
      try {
        ws.send(JSON.stringify(p));
      } catch {}
    }
  }

  function scheduleReconnect(immediate = false) {
    if (reconnectTimer) clearTimeout(reconnectTimer);

    reconnectAttempts++;
    const delay = immediate ? 50 : Math.min(10000, 500 * Math.pow(1.6, reconnectAttempts));
    reconnectTimer = setTimeout(connectWS, delay);
  }

  function connectWS() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    clearHeartbeat();

    const url = wsBase + wsUrlBuilders[builderIndex](channelId);
    console.log("[overlay] connecting:", url);

    ws = new WebSocket(url);

    ws.addEventListener("open", () => {
      openedAt = Date.now();
      reconnectAttempts = 0;
      console.log("[overlay] WS open");

      // Some servers require an immediate subscribe message.
      sendSubscribe();

      // Keepalive
      startHeartbeat();
    });

    ws.addEventListener("close", (ev) => {
      const aliveMs = openedAt ? Date.now() - openedAt : 0;

      console.log("[overlay] WS closed", {
        code: ev.code,
        reason: ev.reason,
        wasClean: ev.wasClean,
        aliveMs,
        tried: builderIndex,
      });

      clearHeartbeat();

      // If it closes almost immediately, try the next URL style (param name mismatch).
      if (aliveMs < 1500 && builderIndex < wsUrlBuilders.length - 1) {
        builderIndex++;
        scheduleReconnect(true);
        return;
      }

      // Otherwise normal backoff reconnect (keep current builderIndex).
      scheduleReconnect(false);
    });

    ws.addEventListener("error", (e) => {
      console.error("[overlay] WS error:", e);
      // close handler will handle reconnect
    });

    ws.addEventListener("message", onWSMessage);
  }

  // ===== Elephant sound (disabled by default) =====
  if (elephantEnabled) {
    const ELEPHANT_INTERVAL_MS = 15 * 60 * 1000;

    // Only enable if you actually add /public/elephant.mp3 to your deployment.
    const elephantAudio = new Audio("/elephant.mp3");
    elephantAudio.preload = "auto";

    let elephantStarted = false;

    function playElephant() {
      try {
        elephantAudio.currentTime = 0;
        const p = elephantAudio.play();
        if (p && typeof p.catch === "function") {
          p.catch((err) => console.warn("[overlay] elephant play blocked:", err));
        }
      } catch (e) {
        console.warn("[overlay] elephant play error:", e);
      }
    }

    function startElephant() {
      if (elephantStarted) return;
      elephantStarted = true;
      playElephant();
      setInterval(playElephant, ELEPHANT_INTERVAL_MS);
      window.removeEventListener("click", startElephant);
      window.removeEventListener("keydown", startElephant);
    }

    window.addEventListener("click", startElephant);
    window.addEventListener("keydown", startElephant);
  }
  // ===== end elephant sound =====

  // ===== Chat speed → hype GIF (with 30 min cooldown) =====
  const HYPE_THRESHOLD = 500; // msgs per minute
  const HYPE_DURATION_MS = 8000;
  const HYPE_COOLDOWN_MS = 30 * 60 * 1000;
  const SPEED_WINDOW_MS = 60000;

  const hypeEl = document.getElementById("hype");
  const hypeImg = document.getElementById("hype-img");
  const arrivalTimes = [];
  let hypeTimer = null;
  let hypeVisible = false;
  let lastHypeAt = 0;
  let hypeReady = false;

  (function resolveHypeGif() {
    if (!hypeEl || !hypeImg) return;

    const override = params.get("hype");
    const dirPath = (function () {
      const p = window.location.pathname;
      const idx = p.lastIndexOf("/");
      return idx > 0 ? p.slice(0, idx) : "/";
    })();

    const candidates = override
      ? [decodeURIComponent(override)]
      : ["/pepe.gif", "pepe.gif", dirPath.replace(/\/+$/, "") + "/pepe.gif"];

    let idx = 0;
    function tryNext() {
      if (idx >= candidates.length) return;
      const src = candidates[idx++];
      const img = new Image();
      img.onload = () => {
        hypeImg.src = src;
        hypeReady = true;
      };
      img.onerror = () => tryNext();
      img.src = src;
    }
    tryNext();
  })();

  function recordMessageArrival() {
    const now = Date.now();
    arrivalTimes.push(now);
    while (arrivalTimes.length && now - arrivalTimes[0] > SPEED_WINDOW_MS) {
      arrivalTimes.shift();
    }
    const ratePerMin = (arrivalTimes.length * 60000) / SPEED_WINDOW_MS;

    if (ratePerMin >= HYPE_THRESHOLD && now - lastHypeAt > HYPE_COOLDOWN_MS) {
      triggerHypeGif(now);
    }
  }

  function triggerHypeGif(now) {
    if (!hypeEl || !hypeReady) return;
    lastHypeAt = now;
    if (hypeVisible) return;

    hypeVisible = true;
    hypeEl.classList.add("show");

    if (hypeTimer) clearTimeout(hypeTimer);
    hypeTimer = setTimeout(() => {
      hypeVisible = false;
      hypeEl.classList.remove("show");
      hypeTimer = null;
    }, HYPE_DURATION_MS);
  }
  // ===== end hype GIF =====

  // Stable vibrant colors
  const colorCache = new Map();
  const palette = [
    "#FF0000",
    "#00FFB7",
    "#FF8400",
    "#00F7FF",
    "#BF00FF",
    "#FF91BF",
    "#707EFF",
    "#779997",
    "#FFF700",
  ];

  function nameColor(name) {
    if (colorCache.has(name)) return colorCache.get(name);
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (Math.imul(31, h) + name.charCodeAt(i)) | 0;
    const c = palette[Math.abs(h) % palette.length];
    colorCache.set(name, c);
    return c;
  }

  const OWNER_IMG = "/badges/owner.png";
  const MOD_IMG = "/badges/mod.gif";

  function makeBadgeImg(src, alt) {
    const img = document.createElement("img");
    img.src = src;
    img.alt = alt || "";
    return img;
  }

  // ========= Emoji normalization (FIX) =========
  const graphemeSegmenter =
    typeof Intl !== "undefined" && Intl.Segmenter
      ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
      : null;

  let isEmojiSegment = null;
  try {
    const re = /\p{Extended_Pictographic}/u;
    isEmojiSegment = (s) => re.test(s);
  } catch {
    const fallback = /(?:[\uD83C-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF])/;
    isEmojiSegment = (s) => fallback.test(s);
  }

  function normalizeEmojiImages(container) {
    const candidates = container.querySelectorAll(
      'img.yt-emoji, img.emoji, img[src*="yt3.ggpht.com"], img[src*="googleusercontent"], img[src*="ggpht"]',
    );
    candidates.forEach((oldImg) => {
      const src = oldImg.getAttribute("data-src") || oldImg.getAttribute("src") || "";
      const alt = oldImg.getAttribute("alt") || ":emoji:";
      const newImg = document.createElement("img");
      newImg.alt = alt;
      newImg.className = "emoji";
      newImg.decoding = "async";
      newImg.loading = "eager";
      newImg.referrerPolicy = "no-referrer";
      newImg.crossOrigin = "anonymous";
      newImg.onerror = () => oldImg.replaceWith(document.createTextNode(alt));
      newImg.src = src;
      oldImg.replaceWith(newImg);
    });
  }

  function normalizeUnicodeEmoji(container) {
    if (!container) return;

    const walker = document.createTreeWalker(
      container,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const p = node.parentNode;
          if (!p) return NodeFilter.FILTER_REJECT;
          if (p.closest && p.closest(".emoji-char")) return NodeFilter.FILTER_REJECT;

          const t = node.nodeValue;
          if (!t || !t.trim()) return NodeFilter.FILTER_REJECT;
          if (!isEmojiSegment(t)) return NodeFilter.FILTER_REJECT;

          return NodeFilter.FILTER_ACCEPT;
        },
      },
      false,
    );

    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);

    const fallbackEmojiSeq = /(?:[\uD83C-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF])/g;

    nodes.forEach((node) => {
      const text = node.nodeValue;
      if (!text) return;

      const frag = document.createDocumentFragment();

      if (graphemeSegmenter) {
        for (const { segment } of graphemeSegmenter.segment(text)) {
          if (isEmojiSegment(segment)) {
            const span = document.createElement("span");
            span.className = "emoji emoji-char";
            span.textContent = segment;
            frag.appendChild(span);
          } else {
            frag.appendChild(document.createTextNode(segment));
          }
        }
      } else {
        fallbackEmojiSeq.lastIndex = 0;
        if (!fallbackEmojiSeq.test(text)) return;
        fallbackEmojiSeq.lastIndex = 0;

        let last = 0;
        let match;
        while ((match = fallbackEmojiSeq.exec(text))) {
          const idx = match.index;
          if (idx > last) frag.appendChild(document.createTextNode(text.slice(last, idx)));

          const span = document.createElement("span");
          span.className = "emoji emoji-char";
          span.textContent = match[0];
          frag.appendChild(span);

          last = idx + match[0].length;
        }
        if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      }

      node.parentNode.replaceChild(frag, node);
    });
  }

  function buildLine(author, html, isMod, isOwner, isMember, memberBadges) {
    const line = document.createElement("div");
    line.className = "line";

    const a = document.createElement("span");
    a.className = "author";
    a.style.color = nameColor(author || "User");

    if (isOwner) a.appendChild(makeBadgeImg(OWNER_IMG, "owner"));
    if (isMod) a.appendChild(makeBadgeImg(MOD_IMG, "mod"));
    if (isMember && memberBadges && memberBadges.length) {
      a.appendChild(makeBadgeImg(memberBadges[0], "member"));
    }

    a.appendChild(document.createTextNode((author || "User").toUpperCase() + ": "));

    const m = document.createElement("span");
    m.className = "message";
    m.innerHTML = html || "";

    normalizeEmojiImages(m);
    normalizeUnicodeEmoji(m);

    line.appendChild(a);
    line.appendChild(m);
    return line;
  }

  function onWSMessage(ev) {
    let data;
    try {
      data = JSON.parse(ev.data);
    } catch {
      // If server sends non-JSON pings, ignore
      return;
    }

    if (!data || data.type !== "chat" || !Array.isArray(data.items)) return;

    for (const item of data.items) {
      const line = buildLine(
        item.author,
        item.html,
        !!item.isMod,
        !!item.isOwner,
        !!item.isMember,
        item.memberBadges || [],
      );

      stack.appendChild(line);

      // animate push-up
      const children = Array.from(stack.children);
      if (children.length > 1) {
        const shift = line.getBoundingClientRect().height + 10;
        stack.style.transform = `translateY(-${shift}px)`;
        requestAnimationFrame(() => {
          stack.style.transform = "translateY(0)";
        });
      }

      requestAnimationFrame(() => line.classList.add("enter"));
      recordMessageArrival();
    }

    const maxKeep =
      parseInt(getComputedStyle(document.documentElement).getPropertyValue("--max-keep")) || 600;
    while (stack.children.length > maxKeep) stack.removeChild(stack.firstChild);
  }

  // Start
  connectWS();
})();
