// public/overlay.js
(function () {
  const stack = document.getElementById("stack");

  // Tuning: ?fs=36&keep=600&hype=<url>&emojiStyle=apple|google|twitter|facebook
  const params = new URLSearchParams(location.search);
  const fontSize = parseInt(params.get("fs") || "36", 10);
  const keepParam = params.get("keep");
  document.documentElement.style.setProperty("--font-size", `${fontSize}px`);
  if (keepParam) document.documentElement.style.setProperty("--max-keep", parseInt(keepParam, 10));

  const channelId = decodeURIComponent(location.pathname.split("/").pop());
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  const WS_URL = `${scheme}://${location.host}/ws?channelId=${encodeURIComponent(channelId)}`;

  // Owner/Mod badge assets
  const OWNER_IMG = "/public/badges/owner.png";
  const MOD_IMG = "/public/badges/mod.gif";

  // ===== Periodic elephant sound (every 15 minutes) =====
  const ELEPHANT_INTERVAL_MS = 15 * 60 * 1000;
  const elephantAudio = new Audio("/elephant.mp3");
  elephantAudio.preload = "auto";
  function playElephant() {
    try {
      elephantAudio.currentTime = 0;
      const p = elephantAudio.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch {}
  }
  setInterval(playElephant, ELEPHANT_INTERVAL_MS);

  // ===== Chat speed → hype GIF (with 30 min cooldown) =====
  const HYPE_THRESHOLD = 500;
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
    const override = params.get("hype");
    const dirPath = (function () {
      const p = window.location.pathname;
      const idx = p.lastIndexOf("/");
      return idx > 0 ? p.slice(0, idx) : "/";
    })();

    const candidates = override
      ? [decodeURIComponent(override)]
      : [
          "/pepe.gif",
          "/public/pepe.gif",
          "pepe.gif",
          "public/pepe.gif",
          `${dirPath.replace(/\/$/, "")}/pepe.gif`,
          `${dirPath.replace(/\/$/, "")}/public/pepe.gif`,
        ];

    let i = 0;
    const tryNext = () => {
      if (!hypeImg || i >= candidates.length) return;
      hypeImg.onload = () => (hypeReady = true);
      hypeImg.onerror = () => {
        i++;
        tryNext();
      };
      hypeImg.decoding = "async";
      hypeImg.referrerPolicy = "no-referrer";
      hypeImg.crossOrigin = "anonymous";
      hypeImg.src = candidates[i];
    };
    tryNext();
  })();

  function recordMessages(count) {
    const now = Date.now();
    for (let i = 0; i < count; i++) arrivalTimes.push(now);
    const cutoff = now - SPEED_WINDOW_MS;
    while (arrivalTimes.length && arrivalTimes[0] < cutoff) arrivalTimes.shift();
    if (arrivalTimes.length > HYPE_THRESHOLD) triggerHype(now);
  }

  function triggerHype(now) {
    if (!now) now = Date.now();
    if (now - lastHypeAt < HYPE_COOLDOWN_MS) return;
    if (!hypeReady) return;

    lastHypeAt = now;
    if (hypeVisible) return;

    hypeVisible = true;
    if (hypeEl) hypeEl.classList.add("show");

    if (hypeTimer) clearTimeout(hypeTimer);
    hypeTimer = setTimeout(() => {
      hypeVisible = false;
      if (hypeEl) hypeEl.classList.remove("show");
      hypeTimer = null;
    }, HYPE_DURATION_MS);
  }

  // Stable vibrant colors
  const colorCache = new Map();
  const palette = [
    "#FF4D4D",
    "#FF8A4D",
    "#FFCA3A",
    "#8AC926",
    "#52D1DC",
    "#4D96FF",
    "#B04DFF",
    "#FF4DB7",
    "#32D583",
    "#F97066",
    "#12B0E8",
    "#7A5AF8",
    "#EE46BC",
    "#16BDCA",
  ];
  function nameColor(name) {
    if (colorCache.has(name)) return colorCache.get(name);
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (Math.imul(31, h) + name.charCodeAt(i)) | 0;
    const c = palette[Math.abs(h) % palette.length];
    colorCache.set(name, c);
    return c;
  }

  function isBot(name) {
    const n = String(name || "").toLowerCase().replace(/\s+/g, "");
    return n === "nightbot" || n === "streamlabs" || n === "streamelements";
  }

  // --- WebSocket + frame-batched inbox (kept) ---
  const inbox = [];
  let rafPending = false;
  function scheduleFlush() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      const batch = inbox.splice(0, inbox.length);
      if (batch.length) enqueueForBurst(batch);
    });
  }

  let ws;
  function connect() {
    ws = new WebSocket(WS_URL);
    ws.onopen = () => console.log("[overlay] ws connected");
    ws.onclose = () => setTimeout(connect, 250);
    ws.onerror = () => ws.close();
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "status") {
          inbox.push({ type: "system", author: "System", html: escapeHtml(String(msg.text)) });
          scheduleFlush();
        } else if (msg.type === "single") {
          inbox.push(msg.message);
          scheduleFlush();
        } else if (msg.type === "batch") {
          for (const m of msg.messages) inbox.push(m);
          scheduleFlush();
        }
      } catch {}
    };
  }
  connect();

  // =========================
  // EMOJI REPLACEMENT
  // =========================
  const EMOJI_STYLE = (params.get("emojiStyle") || "twitter").toLowerCase();
  const EMOJI_SIZE_PX = Math.round(fontSize * 1.3);

  function getEmojiImageUrl(codepoints) {
    const hex = codepoints.map((cp) => cp.toString(16)).join("-");
    if (EMOJI_STYLE === "twitter" || EMOJI_STYLE === "twemoji") {
      return `https://cdn.jsdelivr.net/gh/jdecked/twemoji@latest/assets/72x72/${hex}.png`;
    } else {
      const style = ["apple", "google", "facebook"].includes(EMOJI_STYLE) ? EMOJI_STYLE : "apple";
      return `https://emoji.aranja.com/emojis/${style}/${hex}.png`;
    }
  }

  function emojiToCodepoints(emoji) {
    const codepoints = [];
    for (let i = 0; i < emoji.length; i++) {
      const cp = emoji.codePointAt(i);
      codepoints.push(cp);
      if (cp > 0xffff) i++;
    }
    return codepoints.filter((cp) => cp !== 0xfe0f && cp !== 0xfe0e);
  }

  function createEmojiImage(emojiChar) {
    const codepoints = emojiToCodepoints(emojiChar);
    const url = getEmojiImageUrl(codepoints);

    const img = document.createElement("img");
    img.src = url;
    img.alt = emojiChar;
    img.className = "emoji-img";
    img.draggable = false;
    img.loading = "eager";
    img.decoding = "async";

    img.onerror = () => {
      if (!img.src.includes("twemoji")) {
        const hex = codepoints.map((cp) => cp.toString(16)).join("-");
        img.src = `https://cdn.jsdelivr.net/gh/jdecked/twemoji@latest/assets/72x72/${hex}.png`;
      }
    };

    return img;
  }

  // fast pre-check to avoid TreeWalker on most messages
  const EMOJI_FAST_CHECK =
    /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F6FF}]/u;

  function replaceUnicodeEmoji(container) {
    const whole = container.textContent || "";
    if (!whole || !EMOJI_FAST_CHECK.test(whole)) return;

    const emojiRegex =
      /[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{1F000}-\u{1F6FF}\u{1F900}-\u{1FAFF}][\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{1F300}-\u{1FAFF}]*/gu;

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    let node;
    while ((node = walker.nextNode())) textNodes.push(node);

    textNodes.forEach((textNode) => {
      const text = textNode.nodeValue;
      if (!text) return;

      emojiRegex.lastIndex = 0;
      if (!emojiRegex.test(text)) return;

      const fragment = document.createDocumentFragment();
      let lastIndex = 0;

      emojiRegex.lastIndex = 0;
      let match;
      while ((match = emojiRegex.exec(text)) !== null) {
        if (match.index > lastIndex) {
          fragment.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
        }
        fragment.appendChild(createEmojiImage(match[0]));
        lastIndex = match.index + match[0].length;
      }

      if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
      }

      textNode.parentNode.replaceChild(fragment, textNode);
    });
  }

  function normalizeEmojiImages(container) {
    const candidates = container.querySelectorAll(
      'img.yt-emoji, img.emoji, img[src*="yt3.ggpht.com"], img[src*="googleusercontent"], img[src*="ggpht"]',
    );
    candidates.forEach((img) => {
      img.className = "emoji-img";
      img.draggable = false;
    });
  }

  function forceEmojiSize(container) {
    const emojiImages = container.querySelectorAll(".emoji-img");
    emojiImages.forEach((img) => {
      img.style.width = `${EMOJI_SIZE_PX}px`;
      img.style.height = `${EMOJI_SIZE_PX}px`;
      img.style.display = "inline-block";
      img.style.verticalAlign = "middle";
      img.style.margin = "0 2px";
      img.style.objectFit = "contain";
    });
  }

  // ==========================================================
  // BULK + BURST: buffer briefly, then burst super rapidly
  // while staying smooth (time-budgeted per frame).
  // ==========================================================
  const renderQueue = [];
  let burstTimer = null;
  let bursting = false;

  // Buffer a tiny moment so bursts look clean (and reduces per-message overhead)
  const BURST_BUFFER_MS = 22;     // lower = more instant, higher = more "grouped"
  const FRAME_BUDGET_MS = 12;     // work per frame (keeps smoothness)
  const MAX_PER_FRAME = 140;      // how many messages we can burst per frame (very fast)

  function enqueueForBurst(items) {
    for (const it of items) renderQueue.push(it);

    if (!burstTimer) {
      burstTimer = setTimeout(() => {
        burstTimer = null;
        if (!bursting) {
          bursting = true;
          requestAnimationFrame(burstFrame);
        }
      }, BURST_BUFFER_MS);
    }
  }

  function burstFrame() {
    const t0 = performance.now();

    const fragment = document.createDocumentFragment();
    const entered = [];
    let processed = 0;
    let nonSystemCount = 0;

    while (
      renderQueue.length &&
      processed < MAX_PER_FRAME &&
      performance.now() - t0 < FRAME_BUDGET_MS
    ) {
      const payload = renderQueue.shift();
      const { author, html, type } = payload || {};

      if (type !== "system" && isBot(author)) continue;
      if (type !== "system") nonSystemCount++;

      const line = buildLine(
        type === "system" ? "System" : author || "User",
        html || "",
        !!(payload && payload.isMod),
        !!(payload && payload.isOwner),
        !!(payload && payload.isMember),
        Array.isArray(payload && payload.member_badges) ? payload.member_badges : [],
      );

      fragment.appendChild(line);
      entered.push(line);
      processed++;
    }

    if (fragment.childNodes.length) {
      stack.appendChild(fragment);

      // Trigger CSS enter transition cleanly in next frame (smooth, even when bursting)
      requestAnimationFrame(() => {
        for (const el of entered) el.classList.add("enter");
      });

      if (nonSystemCount > 0) recordMessages(nonSystemCount);

      const maxKeep =
        parseInt(getComputedStyle(document.documentElement).getPropertyValue("--max-keep")) || 600;
      while (stack.children.length > maxKeep) stack.removeChild(stack.firstChild);
    }

    if (renderQueue.length) {
      requestAnimationFrame(burstFrame);
    } else {
      bursting = false;
    }
  }

  function buildLine(author, html, isMod, isOwner, isMember, memberBadges) {
    const line = document.createElement("div");
    line.className = "line"; // starts hidden by your CSS until ".enter" is added

    const a = document.createElement("span");
    a.className = "author";
    a.style.color = nameColor(author || "User");

    if (isOwner) a.appendChild(makeBadgeImg(OWNER_IMG, "owner"));
    if (isMod) a.appendChild(makeBadgeImg(MOD_IMG, "mod"));
    if (isMember && memberBadges && memberBadges.length) {
      a.appendChild(makeBadgeImg(memberBadges[0], "member"));
    }

    a.appendChild(document.createTextNode(`${(author || "User").toUpperCase()}:`));

    const m = document.createElement("span");
    m.className = "message";
    m.innerHTML = ` ${html}`;

    // Emoji handling (optimized a bit)
    normalizeEmojiImages(m);
    replaceUnicodeEmoji(m);
    forceEmojiSize(m);

    line.appendChild(a);
    line.appendChild(m);
    return line;
  }

  function makeBadgeImg(src, alt) {
    const img = document.createElement("img");
    img.alt = alt || "badge";
    img.style.height = "1em";
    img.style.width = "auto";
    img.style.verticalAlign = "-0.12em";
    img.style.marginRight = "0.18em";
    img.decoding = "async";
    img.loading = "eager";
    img.referrerPolicy = "no-referrer";
    img.crossOrigin = "anonymous";
    img.src = src;
    return img;
  }

  function escapeHtml(s) {
    return String(s).replace(
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
  }
})();
