// public/overlay.js
(function () {
  const stack = document.getElementById("stack");

  // Tuning: ?fs=36&keep=600&hype=<url>
  const params = new URLSearchParams(location.search);
  const fontSize = parseInt(params.get("fs") || "36", 10);
  const keepParam = params.get("keep");
  document.documentElement.style.setProperty("--font-size", `${fontSize}px`);
  if (keepParam)
    document.documentElement.style.setProperty("--max-keep", parseInt(keepParam, 10));

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
      if (p && typeof p.catch === "function") {
        p.catch((err) => {
          console.warn("[overlay] elephant.mp3 play blocked or failed:", err);
        });
      }
    } catch (err) {
      console.warn("[overlay] elephant.mp3 play error:", err);
    }
  }

  setInterval(playElephant, ELEPHANT_INTERVAL_MS);
  // ===== end periodic elephant sound =====

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
      if (i >= candidates.length) return;
      hypeImg.onload = () => {
        hypeReady = true;
      };
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

    const perMinute = arrivalTimes.length;
    if (perMinute > HYPE_THRESHOLD) triggerHype(now);
  }

  function triggerHype(now) {
    if (!now) now = Date.now();
    if (now - lastHypeAt < HYPE_COOLDOWN_MS) return;
    if (!hypeReady) return;

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
    for (let i = 0; i < name.length; i++)
      h = (Math.imul(31, h) + name.charCodeAt(i)) | 0;
    const c = palette[Math.abs(h) % palette.length];
    colorCache.set(name, c);
    return c;
  }

  function isBot(name) {
    const n = String(name || "").toLowerCase().replace(/\s+/g, "");
    return n === "nightbot" || n === "streamlabs" || n === "streamelements";
  }

  // --- WebSocket + frame-batched pushes ---
  const inbox = [];
  let rafPending = false;
  function scheduleFlush() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      const batch = inbox.splice(0, inbox.length);
      if (batch.length) pushBatch(batch);
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
          inbox.push({
            type: "system",
            author: "System",
            html: escapeHtml(String(msg.text)),
          });
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

  function pushBatch(items) {
    const fragment = document.createDocumentFragment();
    const newLines = [];
    let nonSystemCount = 0;

    for (const payload of items) {
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

      line.style.opacity = "0";
      line.style.transform = "translateY(8px)";
      fragment.appendChild(line);
      newLines.push(line);
    }
    if (!newLines.length) return;

    if (nonSystemCount > 0) recordMessages(nonSystemCount);

    stack.appendChild(fragment);

    // push-up
    const cs = getComputedStyle(stack);
    const gap = parseFloat(cs.rowGap || cs.gap || "0") || 0;
    let pushBy = 0;
    newLines.forEach((el) => {
      pushBy += el.offsetHeight + gap;
    });

    stack.style.transition = "none";
    stack.style.transform = `translateY(${pushBy}px)`;
    stack.getBoundingClientRect();
    stack.style.transition = "";
    stack.style.transform = "translateY(0)";

    requestAnimationFrame(() => {
      newLines.forEach((el) => el.classList.add("enter"));
      setTimeout(() => {
        newLines.forEach((el) => {
          el.style.opacity = "";
          el.style.transform = "";
        });
      }, 200);
    });

    const maxKeep =
      parseInt(getComputedStyle(document.documentElement).getPropertyValue("--max-keep")) || 600;
    while (stack.children.length > maxKeep) stack.removeChild(stack.firstChild);
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

    a.appendChild(document.createTextNode(`${(author || "User").toUpperCase()}:`));

    const m = document.createElement("span");
    m.className = "message";
    m.innerHTML = ` ${html}`;

    normalizeEmojiImages(m);  // YouTube emoji <img>
    normalizeUnicodeEmoji(m); // Unicode emoji <span>

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

  function normalizeEmojiImages(container) {
    const candidates = container.querySelectorAll(
      'img.yt-emoji, img.emoji, img[src*="yt3.ggpht.com"], img[src*="googleusercontent"], img[src*="ggpht"]',
    );
    candidates.forEach((oldImg) => {
      const src = oldImg.getAttribute("data-src") || oldImg.getAttribute("src") || "";
      const alt = oldImg.getAttribute("alt") || ":emoji:";

      const newImg = document.createElement("img");
      newImg.alt = alt;
      newImg.className = "emoji-img";
      newImg.decoding = "async";
      newImg.loading = "eager";
      newImg.referrerPolicy = "no-referrer";
      newImg.crossOrigin = "anonymous";
      newImg.onerror = () => oldImg.replaceWith(document.createTextNode(alt));
      newImg.src = src;

      oldImg.replaceWith(newImg);
    });
  }

  // ✅ FIX: Unicode emoji styling + grapheme-safe wrapping
  function normalizeUnicodeEmoji(container) {
    const seg =
      typeof Intl !== "undefined" && Intl.Segmenter
        ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
        : null;

    let isEmoji = null;
    try {
      const re = /\p{Extended_Pictographic}/u;
      isEmoji = (s) => re.test(s);
    } catch {
      const fallback = /(?:[\uD83C-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF])/;
      isEmoji = (s) => fallback.test(s);
    }

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);

    function makeEmojiSpan(txt) {
      const span = document.createElement("span");
      span.className = "emoji-char";
      span.textContent = txt;

      // Inline = guaranteed fix even if CSS is cached/overridden
      span.style.display = "inline-block";
      span.style.fontSize = "1.15em";
      span.style.lineHeight = "1";
      span.style.fontWeight = "400";
      span.style.verticalAlign = "-0.30em";
      span.style.position = "relative";
      span.style.top = "0.06em";
      span.style.fontFamily =
        '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",system-ui,-apple-system,"Segoe UI",Arial,sans-serif';

      return span;
    }

    const fallbackEmojiSeq =
      /(?:[\uD83C-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF])(?:\uFE0F)?(?:\u200D(?:[\uD83C-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF])(?:\uFE0F)?)*?/g;

    nodes.forEach((node) => {
      const text = node.nodeValue;
      if (!text || !text.trim()) return;

      // quick skip
      if (!isEmoji(text) && !/[\u200D\uFE0F]/.test(text)) return;

      const frag = document.createDocumentFragment();

      if (seg) {
        let changed = false;
        for (const { segment } of seg.segment(text)) {
          if (isEmoji(segment)) {
            frag.appendChild(makeEmojiSpan(segment));
            changed = true;
          } else {
            frag.appendChild(document.createTextNode(segment));
          }
        }
        if (!changed) return;
      } else {
        let last = 0;
        let m;
        fallbackEmojiSeq.lastIndex = 0;
        while ((m = fallbackEmojiSeq.exec(text))) {
          const idx = m.index;
          if (idx > last) frag.appendChild(document.createTextNode(text.slice(last, idx)));
          frag.appendChild(makeEmojiSpan(m[0]));
          last = idx + m[0].length;
        }
        if (last === 0) return;
        if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      }

      node.parentNode.replaceChild(frag, node);
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m]);
  }
})();
