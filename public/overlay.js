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
        p.catch((err) => console.warn("[overlay] elephant.mp3 play blocked or failed:", err));
      }
    } catch (err) {
      console.warn("[overlay] elephant.mp3 play error:", err);
    }
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

    normalizeEmojiImages(m);        // YouTube emoji <img>
    replaceUnicodeEmoji(m);         // Unicode -> Noto animated/static -> GitHub -> Twemoji
    forceEmojiLayoutPx(m);          // ✅ hard baseline + square sizing (no narrow)

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

  function wrapEmojiNode(node) {
    const box = document.createElement("span");
    box.className = "emoji-box";
    box.appendChild(node);
    return box;
  }

  // YouTube custom emoji images (<img>) => box them
  function normalizeEmojiImages(container) {
    const candidates = container.querySelectorAll(
      'img.yt-emoji, img.emoji, img[src*="yt3.ggpht.com"], img[src*="googleusercontent"], img[src*="ggpht"]',
    );
    candidates.forEach((oldImg) => {
      const src = oldImg.getAttribute("data-src") || oldImg.getAttribute("src") || "";
      const alt = oldImg.getAttribute("alt") || ":emoji:";

      const img = document.createElement("img");
      img.alt = alt;
      img.decoding = "async";
      img.loading = "eager";
      img.referrerPolicy = "no-referrer";
      img.crossOrigin = "anonymous";
      img.src = src;

      const boxed = wrapEmojiNode(img);
      img.onerror = () => boxed.replaceWith(document.createTextNode(alt));
      oldImg.replaceWith(boxed);
    });
  }

  // ===== Unicode emoji replacement (ALWAYS ends in an image) =====

  // Google-hosted Noto assets pattern (animated/static). :contentReference[oaicite:1]{index=1}
  const NOTO_GSTATIC = "https://fonts.gstatic.com/s/e/notoemoji/latest/";

  // GitHub Noto fallback (static PNGs). :contentReference[oaicite:2]{index=2}
  const NOTO_GITHUB_PNG_128 = "https://raw.githubusercontent.com/googlefonts/noto-emoji/main/png/128/";

  // Twemoji PNG fallback (always exists broadly). :contentReference[oaicite:3]{index=3}
  const TWEMOJI_PNG_72 = "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/";

  const graphemes =
    typeof Intl !== "undefined" && Intl.Segmenter
      ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
      : null;

  let hasPictographic = null;
  try {
    const re = /\p{Extended_Pictographic}/u;
    hasPictographic = (s) => re.test(s);
  } catch {
    const fallback = /(?:[\uD83C-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF])/;
    hasPictographic = (s) => fallback.test(s);
  }

  function emojiCodepoints(emojiText) {
    const cps = [];
    for (let i = 0; i < emojiText.length; i++) {
      const cp = emojiText.codePointAt(i);
      cps.push(cp);
      if (cp > 0xffff) i++;
    }
    return cps;
  }

  function toHexNoPrefix(cp) {
    return cp.toString(16);
  }

  function toNotoFolder(cps) {
    return cps.map(toHexNoPrefix).join("_");
  }

  function toNotoGithubFilename(cps) {
    // github format: emoji_u1f468_200d_2696.png
    return "emoji_u" + cps.map(toHexNoPrefix).join("_") + ".png";
  }

  function toTwemojiFilename(cps) {
    // twemoji format: 1f1e6-1f1fd.png etc
    return cps.map(toHexNoPrefix).join("-") + ".png";
  }

  function isSkinTone(cp) {
    return cp >= 0x1f3fb && cp <= 0x1f3ff;
  }

  function generateVariantCodepointLists(cps) {
    const uniq = new Map();
    const add = (arr) => {
      const key = arr.join(",");
      if (!uniq.has(key) && arr.length) uniq.set(key, arr);
    };

    // 1) original
    add(cps);

    // 2) strip variation selectors (FE0F/FE0E)
    add(cps.filter((cp) => cp !== 0xfe0f && cp !== 0xfe0e));

    // 3) strip skin tone modifiers
    add(cps.filter((cp) => !isSkinTone(cp)));

    // 4) strip both VS + skin tone
    add(cps.filter((cp) => cp !== 0xfe0f && cp !== 0xfe0e && !isSkinTone(cp)));

    // 5) if ZWJ sequence exists, try “base emoji only” (first pictographic chunk)
    // This helps when an animated asset doesn’t exist for the full family/gender combo.
    const zwj = 0x200d;
    if (cps.includes(zwj)) {
      // take everything up to first ZWJ (minus VS)
      const first = [];
      for (const cp of cps) {
        if (cp === zwj) break;
        if (cp === 0xfe0f || cp === 0xfe0e) continue;
        if (isSkinTone(cp)) continue;
        first.push(cp);
      }
      add(first);
    }

    return Array.from(uniq.values());
  }

  function makeEmojiImgWithFallbacks(emojiText) {
    const cps = emojiCodepoints(emojiText);
    const variants = generateVariantCodepointLists(cps);

    const candidates = [];

    // For each variant, try (animated webp -> gif -> static png gstatic -> github png)
    for (const v of variants) {
      const folder = toNotoFolder(v);

      candidates.push(`${NOTO_GSTATIC}${folder}/512.webp`);
      candidates.push(`${NOTO_GSTATIC}${folder}/512.gif`);
      candidates.push(`${NOTO_GSTATIC}${folder}/128.png`);

      candidates.push(`${NOTO_GITHUB_PNG_128}${toNotoGithubFilename(v)}`);
    }

    // Final fallback: Twemoji PNG (still an image)
    // Use the most “plain” variant (VS/skin stripped) for best chance.
    const best = variants[variants.length - 1] || cps;
    candidates.push(`${TWEMOJI_PNG_72}${toTwemojiFilename(best)}`);

    const img = document.createElement("img");
    img.alt = emojiText;
    img.decoding = "async";
    img.loading = "eager";
    img.referrerPolicy = "no-referrer";
    img.crossOrigin = "anonymous";

    let i = 0;
    img.onerror = () => {
      i++;
      if (i < candidates.length) img.src = candidates[i];
      else img.replaceWith(document.createTextNode("")); // should basically never happen now
    };

    img.src = candidates[i];
    return wrapEmojiNode(img);
  }

  function replaceUnicodeEmoji(container) {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);

    nodes.forEach((node) => {
      const text = node.nodeValue;
      if (!text || !text.trim()) return;
      if (!hasPictographic(text) && !/[\u200D\uFE0F]/.test(text)) return;

      const frag = document.createDocumentFragment();

      if (graphemes) {
        let changed = false;
        for (const { segment } of graphemes.segment(text)) {
          const isEmojiSeg = hasPictographic(segment) || /[\u200D\uFE0F]/.test(segment);
          if (isEmojiSeg) {
            frag.appendChild(makeEmojiImgWithFallbacks(segment));
            changed = true;
          } else {
            frag.appendChild(document.createTextNode(segment));
          }
        }
        if (!changed) return;
      } else {
        // fallback regex
        const emojiSeq =
          /(?:[\uD83C-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF])(?:\uFE0F|\uFE0E)?(?:\u200D(?:[\uD83C-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF])(?:\uFE0F|\uFE0E)?)*/g;

        let last = 0;
        let m;
        while ((m = emojiSeq.exec(text))) {
          const idx = m.index;
          if (idx > last) frag.appendChild(document.createTextNode(text.slice(last, idx)));
          frag.appendChild(makeEmojiImgWithFallbacks(m[0]));
          last = idx + m[0].length;
        }
        if (last === 0) return;
        if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      }

      node.parentNode.replaceChild(frag, node);
    });
  }

  // HARD FORCE: fix “top stuck” + “narrow” (square) using pixel sizing
  function forceEmojiLayoutPx(container) {
    const line = container.closest(".line") || container;
    const fontPx = parseFloat(getComputedStyle(line).fontSize) || 36;

    // tune these if you want:
    const boxTopPx = Math.round(fontPx * 0.22);
    const sizePx = Math.round(fontPx * 1.12);
    const boxH = Math.round(fontPx * 1.0);

    const boxes = container.querySelectorAll(".emoji-box");
    boxes.forEach((box) => {
      box.style.setProperty("display", "inline-flex", "important");
      box.style.setProperty("align-items", "flex-end", "important");
      box.style.setProperty("justify-content", "center", "important");
      box.style.setProperty("height", `${boxH}px`, "important");
      box.style.setProperty("line-height", "1", "important");
      box.style.setProperty("vertical-align", "baseline", "important");
      box.style.setProperty("position", "relative", "important");
      box.style.setProperty("top", `${boxTopPx}px`, "important");

      const img = box.querySelector("img");
      if (img) {
        // ✅ Never narrow: force square
        img.style.setProperty("width", `${sizePx}px`, "important");
        img.style.setProperty("height", `${sizePx}px`, "important");
        img.style.setProperty("object-fit", "contain", "important");
        img.style.setProperty("display", "block", "important");
      }
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[m]);
  }
})();
