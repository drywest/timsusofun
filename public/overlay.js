// public/overlay.js
(function () {
  const stack = document.getElementById("stack");

  // Tuning: ?fs=36&keep=600&hype=<url>
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
  // Animated emoji index + matching
  // =========================

  const NOTO_API_URL = "https://googlefonts.github.io/noto-emoji-animation/data/api.json";
  const EMOJI_ORDERING_URL =
    "https://raw.githubusercontent.com/googlefonts/emoji-metadata/main/emoji_17_0_ordering.json";

  const LS_API_KEY = "timsu_noto_anim_api_v1";
  const LS_API_TS = "timsu_noto_anim_api_ts_v1";
  const LS_META_KEY = "timsu_emoji_meta_v1";
  const LS_META_TS = "timsu_emoji_meta_ts_v1";
  const CACHE_MS = 7 * 24 * 60 * 60 * 1000;

  const animEmojiToCode = new Map(); // emoji string -> codepoint folder
  const animTagToCode = new Map(); // ":tag:" -> codepoint folder
  const animEntries = []; // { code, tags:Set<string>, primaryTag:string }

  const emojiToShortcodes = new Map(); // emoji string -> [":x:", ...]
  const shortcodeToEmoji = new Map(); // ":x:" -> emoji string

  let animReady = false;
  let metaReady = false;

  function nowMs() {
    return Date.now();
  }

  function safeJsonParse(s) {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  }

  function setLS(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {}
  }
  function getLS(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  }

  function isFresh(tsKey) {
    const ts = parseInt(getLS(tsKey) || "0", 10);
    return ts && nowMs() - ts < CACHE_MS;
  }

  function splitCodeToHexParts(code) {
    // supports: "1f602", "u1f602", "emoji_u1f602", "1f469_200d_2764_fe0f_200d_1f48b_200d_1f468"
    let s = String(code || "");
    s = s.replace(/^emoji_/, "");
    s = s.replace(/^u/, "");
    const parts = s.split(/[_-]/g).filter(Boolean).map((p) => p.replace(/^u/, ""));
    return parts;
  }

  function hexPartsToEmoji(parts) {
    try {
      const cps = parts.map((h) => parseInt(h, 16)).filter((n) => Number.isFinite(n));
      if (!cps.length) return "";
      return String.fromCodePoint(...cps);
    } catch {
      return "";
    }
  }

  function normalizeTag(t) {
    let s = String(t || "").trim().toLowerCase();
    if (!s) return "";
    s = s.replace(/\s+/g, "_").replace(/-+/g, "_");
    s = s.replace(/^:+|:+$/g, "");
    return `:${s}:`;
  }

  function tagTokens(tag) {
    const t = normalizeTag(tag);
    if (!t) return [];
    const core = t.slice(1, -1);
    return core.split(/[_\s-]+/g).filter(Boolean);
  }

  function tokensFromTerm(term) {
    let s = String(term || "").trim().toLowerCase();
    s = s.replace(/^:+|:+$/g, "");
    s = s.replace(/[^a-z0-9_ -]+/g, " ");
    s = s.replace(/\s+/g, " ").trim();
    if (!s) return [];
    return s.split(/[_\s-]+/g).filter(Boolean);
  }

  function jaccard(aSet, bSet) {
    let inter = 0;
    for (const x of aSet) if (bSet.has(x)) inter++;
    const union = aSet.size + bSet.size - inter;
    return union ? inter / union : 0;
  }

  async function fetchJsonWithCache(url, lsKey, tsKey) {
    if (isFresh(tsKey)) {
      const cached = getLS(lsKey);
      const parsed = cached ? safeJsonParse(cached) : null;
      if (parsed) return parsed;
    }
    const res = await fetch(url, { cache: "no-store", mode: "cors" });
    const data = await res.json();
    setLS(lsKey, JSON.stringify(data));
    setLS(tsKey, String(nowMs()));
    return data;
  }

  async function loadAnimIndex() {
    try {
      const data = await fetchJsonWithCache(NOTO_API_URL, LS_API_KEY, LS_API_TS);
      const icons = Array.isArray(data && data.icons) ? data.icons : [];
      animEmojiToCode.clear();
      animTagToCode.clear();
      animEntries.length = 0;

      for (const icon of icons) {
        const code = String(icon && icon.codepoint ? icon.codepoint : "").trim();
        if (!code) continue;

        const parts = splitCodeToHexParts(code);
        const emoji = hexPartsToEmoji(parts);
        if (emoji) animEmojiToCode.set(emoji, parts.join("_"));

        const tagsArr = Array.isArray(icon && icon.tags) ? icon.tags : [];
        const tagSet = new Set();
        let primary = "";

        for (let i = 0; i < tagsArr.length; i++) {
          const t = normalizeTag(tagsArr[i]);
          if (!t) continue;
          tagSet.add(t);
          if (!primary) primary = t;
          if (!animTagToCode.has(t)) animTagToCode.set(t, parts.join("_"));
        }

        // also add plain tokenized variants for matching
        const tokenSet = new Set();
        for (const t of tagSet) for (const tok of tagTokens(t)) tokenSet.add(tok);

        animEntries.push({
          code: parts.join("_"),
          emoji,
          tags: tagSet,
          tokens: tokenSet,
          primaryTag: primary,
        });
      }

      animReady = true;
    } catch {
      animReady = false;
    }
  }

  function codepointsToEmojiFromInts(arr) {
    try {
      if (!Array.isArray(arr) || !arr.length) return "";
      return String.fromCodePoint(...arr.map((n) => Number(n)));
    } catch {
      return "";
    }
  }

  async function loadEmojiMetadata() {
    try {
      const data = await fetchJsonWithCache(EMOJI_ORDERING_URL, LS_META_KEY, LS_META_TS);
      emojiToShortcodes.clear();
      shortcodeToEmoji.clear();

      const groups = Array.isArray(data) ? data : Array.isArray(data && data.groups) ? data.groups : [];
      const allEmojiItems = [];

      for (const g of groups) {
        const list = Array.isArray(g && g.emoji) ? g.emoji : [];
        for (const item of list) allEmojiItems.push(item);
      }

      for (const item of allEmojiItems) {
        const base = codepointsToEmojiFromInts(item && item.base);
        const shorts = Array.isArray(item && item.shortcodes) ? item.shortcodes : [];
        const normShorts = shorts.map(normalizeTag).filter(Boolean);

        if (base && normShorts.length) {
          emojiToShortcodes.set(base, normShorts);
          for (const sc of normShorts) if (!shortcodeToEmoji.has(sc)) shortcodeToEmoji.set(sc, base);
        }

        const alts = Array.isArray(item && item.alternates) ? item.alternates : [];
        for (const altArr of alts) {
          const altEmoji = codepointsToEmojiFromInts(altArr);
          if (altEmoji && normShorts.length && !emojiToShortcodes.has(altEmoji)) {
            emojiToShortcodes.set(altEmoji, normShorts);
          }
        }
      }

      metaReady = true;
    } catch {
      metaReady = false;
    }
  }

  (async function initEmojiIndexes() {
    // load both in parallel
    await Promise.allSettled([loadAnimIndex(), loadEmojiMetadata()]);
  })();

  function stripVariationAndSkin(emojiText) {
    const cps = [];
    for (let i = 0; i < emojiText.length; i++) {
      const cp = emojiText.codePointAt(i);
      if (cp > 0xffff) i++;
      // drop variation selectors
      if (cp === 0xfe0f || cp === 0xfe0e) continue;
      // drop skin tones
      if (cp >= 0x1f3fb && cp <= 0x1f3ff) continue;
      cps.push(cp);
    }
    try {
      return cps.length ? String.fromCodePoint(...cps) : emojiText;
    } catch {
      return emojiText;
    }
  }

  function firstChunkBeforeZWJ(emojiText) {
    const zwj = "\u200d";
    const idx = emojiText.indexOf(zwj);
    if (idx === -1) return emojiText;
    return emojiText.slice(0, idx);
  }

  function gstaticWebp(codeFolder) {
    return `https://fonts.gstatic.com/s/e/notoemoji/latest/${codeFolder}/512.webp`;
  }
  function gstaticGif(codeFolder) {
    return `https://fonts.gstatic.com/s/e/notoemoji/latest/${codeFolder}/512.gif`;
  }

  function resolveAnimatedCodeForEmojiText(emojiText) {
    if (!animReady || !emojiText) return null;

    // exact
    if (animEmojiToCode.has(emojiText)) return animEmojiToCode.get(emojiText);

    // strip VS + skin tone
    const stripped = stripVariationAndSkin(emojiText);
    if (animEmojiToCode.has(stripped)) return animEmojiToCode.get(stripped);

    // first chunk for zwj sequences
    const first = stripVariationAndSkin(firstChunkBeforeZWJ(stripped));
    if (animEmojiToCode.has(first)) return animEmojiToCode.get(first);

    // try shortcode direct from metadata
    const shorts =
      (metaReady && (emojiToShortcodes.get(emojiText) || emojiToShortcodes.get(stripped) || emojiToShortcodes.get(first))) ||
      [];
    for (const sc of shorts) {
      const code = animTagToCode.get(sc);
      if (code) return code;
    }

    // fuzzy match via tokens from shortcodes (or from codepoints if none)
    const queryTokens = new Set();
    for (const sc of shorts) for (const tok of tokensFromTerm(sc)) queryTokens.add(tok);

    // if we got nothing, try to build tokens from any available alt-like term (nothing here)
    if (!queryTokens.size) return null;

    let best = null;
    let bestScore = 0;

    for (const entry of animEntries) {
      const score = jaccard(queryTokens, entry.tokens);
      if (score > bestScore) {
        bestScore = score;
        best = entry.code;
      }
    }

    // only accept if it matches at least something
    if (best && bestScore > 0) return best;
    return null;
  }

  function resolveAnimatedCodeForNameOrTag(raw) {
    if (!animReady) return null;
    const norm = normalizeTag(raw);
    if (norm && animTagToCode.has(norm)) return animTagToCode.get(norm);

    // if it's like "Sob" -> try ":sob:"
    const toks = new Set(tokensFromTerm(raw));
    if (!toks.size) return null;

    let best = null;
    let bestScore = 0;

    for (const entry of animEntries) {
      const score = jaccard(toks, entry.tokens);
      if (score > bestScore) {
        bestScore = score;
        best = entry.code;
      }
    }

    if (best && bestScore > 0) return best;
    return null;
  }

  function wrapEmojiImg(img) {
    const box = document.createElement("span");
    box.className = "emoji-box";
    box.appendChild(img);
    return box;
  }

  function makeAnimatedEmojiBoxFromCode(codeFolder, altText) {
    const img = document.createElement("img");
    img.alt = altText || "";
    img.decoding = "async";
    img.loading = "eager";
    img.referrerPolicy = "no-referrer";
    img.crossOrigin = "anonymous";

    const webp = gstaticWebp(codeFolder);
    const gif = gstaticGif(codeFolder);

    let stage = 0;
    img.onerror = () => {
      stage++;
      if (stage === 1) img.src = gif;
      else img.src = "";
    };
    img.src = webp;

    return wrapEmojiImg(img);
  }

  function makeEmojiBoxFallbackStatic(emojiText) {
    // fallback: keep it as text but inside emoji-box with forced square sizing
    const span = document.createElement("span");
    span.textContent = emojiText;
    const box = document.createElement("span");
    box.className = "emoji-box";
    box.appendChild(span);
    return box;
  }

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
      let changed = false;

      if (graphemes) {
        for (const { segment } of graphemes.segment(text)) {
          const isEmojiSeg = hasPictographic(segment) || /[\u200D\uFE0F]/.test(segment);
          if (isEmojiSeg) {
            const code = resolveAnimatedCodeForEmojiText(segment);
            if (code) {
              frag.appendChild(makeAnimatedEmojiBoxFromCode(code, segment));
            } else {
              frag.appendChild(makeEmojiBoxFallbackStatic(segment));
            }
            changed = true;
          } else {
            frag.appendChild(document.createTextNode(segment));
          }
        }
      } else {
        const emojiSeq =
          /(?:[\uD83C-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF])(?:\uFE0F|\uFE0E)?(?:\u200D(?:[\uD83C-\uDBFF][\uDC00-\uDFFF]|[\u2600-\u27BF])(?:\uFE0F|\uFE0E)?)*/g;

        let last = 0;
        let m;
        while ((m = emojiSeq.exec(text))) {
          const idx = m.index;
          if (idx > last) frag.appendChild(document.createTextNode(text.slice(last, idx)));
          const seg = m[0];
          const code = resolveAnimatedCodeForEmojiText(seg);
          if (code) frag.appendChild(makeAnimatedEmojiBoxFromCode(code, seg));
          else frag.appendChild(makeEmojiBoxFallbackStatic(seg));
          changed = true;
          last = idx + seg.length;
        }
        if (!changed) return;
        if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      }

      if (!changed) return;
      node.parentNode.replaceChild(frag, node);
    });
  }

  // YouTube custom emoji images (<img>) => replace with animated if possible, else box them
  function normalizeEmojiImages(container) {
    const candidates = container.querySelectorAll(
      'img.yt-emoji, img.emoji, img[src*="yt3.ggpht.com"], img[src*="googleusercontent"], img[src*="ggpht"]',
    );

    candidates.forEach((oldImg) => {
      const altRaw =
        oldImg.getAttribute("alt") ||
        oldImg.getAttribute("aria-label") ||
        oldImg.getAttribute("title") ||
        "";

      // If alt is a unicode emoji, use that directly
      let code = null;
      if (altRaw && (hasPictographic(altRaw) || /[\u200D\uFE0F]/.test(altRaw))) {
        code = resolveAnimatedCodeForEmojiText(altRaw);
      }

      // If alt is name-ish, try metadata shortcode mapping then fuzzy tag match
      if (!code && altRaw) {
        const norm = normalizeTag(altRaw);
        if (metaReady && shortcodeToEmoji.has(norm)) {
          const em = shortcodeToEmoji.get(norm);
          code = resolveAnimatedCodeForEmojiText(em);
        }
        if (!code) code = resolveAnimatedCodeForNameOrTag(altRaw);
      }

      if (code) {
        const boxed = makeAnimatedEmojiBoxFromCode(code, altRaw);
        oldImg.replaceWith(boxed);
        return;
      }

      // fallback: keep original img but boxed
      const src = oldImg.getAttribute("data-src") || oldImg.getAttribute("src") || "";
      const img = document.createElement("img");
      img.alt = altRaw || ":emoji:";
      img.decoding = "async";
      img.loading = "eager";
      img.referrerPolicy = "no-referrer";
      img.crossOrigin = "anonymous";
      img.src = src;

      const boxed = wrapEmojiImg(img);
      img.onerror = () => boxed.replaceWith(document.createTextNode(img.alt));
      oldImg.replaceWith(boxed);
    });
  }

  // HARD FORCE: square px sizing for ALL emoji boxes so nothing is top-stuck / narrow
  function forceEmojiLayoutPx(container) {
    const line = container.closest(".line") || container;
    const fontPx = parseFloat(getComputedStyle(line).fontSize) || 36;

    // Tuned for OBS / Chromium baseline
    const sizePx = Math.round(fontPx * 1.15);
    const boxH = Math.round(fontPx * 1.0);

    // Move the box down a bit to sit on baseline (no "stuck to top")
    const yShift = Math.round(fontPx * 0.12);

    const boxes = container.querySelectorAll(".emoji-box");
    boxes.forEach((box) => {
      box.style.setProperty("display", "inline-block", "important");
      box.style.setProperty("height", `${boxH}px`, "important");
      box.style.setProperty("line-height", "1", "important");
      box.style.setProperty("vertical-align", "baseline", "important");
      box.style.setProperty("position", "relative", "important");
      box.style.setProperty("top", `${yShift}px`, "important");

      // force a square, always
      const img = box.querySelector("img");
      if (img) {
        img.style.setProperty("width", `${sizePx}px`, "important");
        img.style.setProperty("height", `${sizePx}px`, "important");
        img.style.setProperty("object-fit", "contain", "important");
        img.style.setProperty("display", "block", "important");
      } else {
        // text fallback inside box
        const span = box.firstChild;
        if (span && span.nodeType === 1) {
          span.style.setProperty("display", "block", "important");
          span.style.setProperty("width", `${sizePx}px`, "important");
          span.style.setProperty("height", `${sizePx}px`, "important");
          span.style.setProperty("line-height", `${sizePx}px`, "important");
          span.style.setProperty("text-align", "center", "important");
        }
      }
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

    normalizeEmojiImages(m);
    replaceUnicodeEmoji(m);
    forceEmojiLayoutPx(m);

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
