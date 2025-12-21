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
  // EMOJI REPLACEMENT - Using Twemoji CDN (most reliable)
  // =========================
  const EMOJI_STYLE = (params.get("emojiStyle") || "twitter").toLowerCase();
  
  // Use Twemoji as primary, fall back to emoji.aranja.com
  function getEmojiImageUrl(codepoints) {
    const hex = codepoints.map(cp => cp.toString(16)).join('-');
    
    if (EMOJI_STYLE === "twitter" || EMOJI_STYLE === "twemoji") {
      // Twemoji CDN - most reliable
      return `https://cdn.jsdelivr.net/gh/jdecked/twemoji@latest/assets/72x72/${hex}.png`;
    } else {
      // emoji.aranja.com for apple, google, facebook
      const style = ["apple", "google", "facebook"].includes(EMOJI_STYLE) ? EMOJI_STYLE : "apple";
      return `https://emoji.aranja.com/emojis/${style}/${hex}.png`;
    }
  }

  function emojiToCodepoints(emoji) {
    const codepoints = [];
    for (let i = 0; i < emoji.length; i++) {
      const cp = emoji.codePointAt(i);
      codepoints.push(cp);
      if (cp > 0xffff) i++; // Skip the next char for surrogate pairs
    }
    // Filter out variation selectors
    return codepoints.filter(cp => cp !== 0xFE0F && cp !== 0xFE0E);
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
    
    // If image fails to load, try Twemoji as fallback
    img.onerror = () => {
      if (!img.src.includes('twemoji')) {
        const hex = codepoints.map(cp => cp.toString(16)).join('-');
        img.src = `https://cdn.jsdelivr.net/gh/jdecked/twemoji@latest/assets/72x72/${hex}.png`;
      }
    };
    
    return img;
  }

  function replaceUnicodeEmoji(container) {
    // Comprehensive emoji regex
    const emojiRegex = /(\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(\u200D(\p{Emoji_Presentation}|\p{Emoji}\uFE0F))*/gu;
    
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    let node;
    while (node = walker.nextNode()) {
      textNodes.push(node);
    }

    textNodes.forEach(textNode => {
      const text = textNode.nodeValue;
      if (!text) return;
      
      // Test if there are any emojis
      emojiRegex.lastIndex = 0;
      if (!emojiRegex.test(text)) return;
      
      const fragment = document.createDocumentFragment();
      let lastIndex = 0;
      
      emojiRegex.lastIndex = 0;
      let match;
      
      while ((match = emojiRegex.exec(text)) !== null) {
        // Add text before emoji
        if (match.index > lastIndex) {
          fragment.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
        }
        
        // Add emoji as image
        fragment.appendChild(createEmojiImage(match[0]));
        lastIndex = match.index + match[0].length;
      }
      
      // Add remaining text
      if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
      }
      
      textNode.parentNode.replaceChild(fragment, textNode);
    });
  }

  // YouTube custom emoji images (<img>) => ensure proper sizing
  function normalizeEmojiImages(container) {
    const candidates = container.querySelectorAll(
      'img.yt-emoji, img.emoji, img[src*="yt3.ggpht.com"], img[src*="googleusercontent"], img[src*="ggpht"]',
    );

    candidates.forEach((img) => {
      img.className = "emoji-img";
      img.draggable = false;
    });
  }

  // Force proper sizing for ALL emoji images
  function forceEmojiSize(container) {
    const line = container.closest(".line") || container;
    const computedStyle = getComputedStyle(line);
    const fontPx = parseFloat(computedStyle.fontSize) || 36;
    
    // Make emojis slightly larger than text for better visibility
    const emojiSize = Math.round(fontPx * 1.3);

    const emojiImages = container.querySelectorAll(".emoji-img");
    emojiImages.forEach((img) => {
      img.style.width = `${emojiSize}px`;
      img.style.height = `${emojiSize}px`;
      img.style.display = "inline-block";
      img.style.verticalAlign = "middle";
      img.style.margin = "0 2px";
      img.style.objectFit = "contain";
    });
  }

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

      // smooth fade (keep it)
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
    newLines.forEach((el) => (pushBy += el.offsetHeight + gap));

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

    // First normalize any existing emoji images from YouTube
    normalizeEmojiImages(m);
    // Then replace all Unicode emojis with images
    replaceUnicodeEmoji(m);
    // Finally force proper sizing on all emoji images
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
