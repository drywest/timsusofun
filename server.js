<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>timsu • Setup</title>
  <meta name="description" content="YouTube Live Chat Overlay - Streamlabs Alternative, Timsu Chat" />
  <link rel="icon" type="image/png" href="favicon.png" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    :root{--bg:#0a0a0b;--text:#e8e8ec;--muted:#a1a1aa;--brand:#3d5a80;--brand-2:#98c1d9;--card:rgba(255,255,255,0.04);--card-glow:rgba(61,90,128,0.35);--ring:rgba(152,193,217,.65);--primary-dark-1:#0b1120;--primary-dark-2:#020617}
    *{box-sizing:border-box}
    html,body{height:100%}
    body{margin:0;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;background:var(--bg);color:var(--text);line-height:1.6;overflow-x:hidden;scroll-behavior:smooth}
    .bg-wrap{position:fixed;inset:0;z-index:-2;background:var(--bg)}
    .bg-gradient{position:absolute;inset:-20vmax;z-index:-2;background:radial-gradient(55vmax 55vmax at 20% 15%,rgba(152,193,217,.22),transparent 60%),radial-gradient(60vmax 60vmax at 80% 10%,rgba(61,90,128,.24),transparent 60%),radial-gradient(70vmax 70vmax at 50% 100%,rgba(255,255,255,.07),transparent 65%);filter:blur(42px) saturate(120%);animation:floatGrad 22s ease-in-out infinite alternate}
    @keyframes floatGrad{to{transform:translate3d(0,-3rem,0) scale(1.03)}}
    .bg-noise{position:absolute;inset:0;z-index:-1;opacity:.06;pointer-events:none;mix-blend-mode:overlay;background-image:url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter><rect width="100%" height="100%" filter="url(%23n)" opacity=".8"/></svg>')}
    .container{max-width:1200px;margin-inline:auto;padding-inline:24px}
    header{position:sticky;top:0;z-index:50;backdrop-filter:saturate(150%) blur(6px);background:linear-gradient(to bottom,rgba(10,10,11,.8),rgba(10,10,11,.35));border-bottom:1px solid rgba(255,255,255,.06)}
    .nav{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:16px;padding:14px 0}
    .brand{justify-self:start;display:inline-flex;align-items:center}
    .brand img{height:30px;width:auto}
    .nav-links{justify-self:center;display:flex;align-items:center;gap:2rem}
    .nav-links a{color:var(--muted);text-decoration:none;font-weight:500;transition:color .2s ease,box-shadow .2s ease}
    .nav-links a:hover{color:var(--text);box-shadow:0 2px 0 0 var(--brand-2)}
    .nav-actions{justify-self:end;display:flex;align-items:center;gap:.75rem}
    .btn{appearance:none;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.03);color:var(--text);padding:.7rem 1rem;border-radius:12px;font-family:inherit;font-weight:600;letter-spacing:.2px;transition:transform .25s ease,border-color .25s ease,box-shadow .25s ease,filter .25s ease;text-decoration:none;display:inline-flex;gap:.5rem;align-items:center;cursor:pointer}
    .btn:hover{transform:translateY(-1px);border-color:rgba(255,255,255,.25)}
    .btn:focus-visible{outline:none;box-shadow:0 0 0 4px var(--ring)}
    .btn-primary{border-color:rgba(148,163,184,.7);background:radial-gradient(circle at 10% 0%,rgba(148,163,184,.40),transparent 55%),linear-gradient(180deg,var(--primary-dark-1),var(--primary-dark-2));box-shadow:0 0 0 1px rgba(15,23,42,.9),0 14px 35px -18px rgba(0,0,0,.9)}
    .btn[disabled]{opacity:.6;cursor:not-allowed;box-shadow:none;transform:none}
    main{position:relative}
    .hero{display:grid;place-items:center;min-height:calc(100svh - 68px);padding-block:4rem}
    .hero-inner{max-width:860px;width:100%}
    .eyebrow{display:inline-flex;gap:.5rem;align-items:center;padding:.30rem .6rem;border-radius:999px;color:var(--muted);background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);font-size:.8rem;margin-bottom:.85rem}
    .eyebrow .dot{width:6px;height:6px;border-radius:999px;background:var(--brand)}
    .title{font-size:clamp(2rem,3vw + 1rem,3rem);line-height:1.05;margin:.2rem 0 .4rem;letter-spacing:-.02em;font-weight:800}
    .sub{margin:0 0 1.6rem;color:#c7c7cf;max-width:420px;font-size:.96rem}
    [data-animate]{opacity:0;transform:translateY(12px);animation:fadeUp .9s ease forwards}
    [data-animate][data-delay="1"]{animation-delay:.05s}
    [data-animate][data-delay="2"]{animation-delay:.12s}
    [data-animate][data-delay="3"]{animation-delay:.2s}
    [data-animate][data-delay="4"]{animation-delay:.3s}
    @keyframes fadeUp{to{opacity:1;transform:none}}
    .setup-grid{display:grid;gap:20px}
    @media (min-width:900px){.setup-grid{grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);align-items:stretch}}
    .card{background:var(--card);border:1px solid rgba(255,255,255,.08);border-radius:18px;padding:18px;position:relative;overflow:hidden;transition:transform .25s ease,box-shadow .25s ease}
    .card:before{content:"";position:absolute;inset:-1px;border-radius:inherit;padding:1px;background:linear-gradient(to bottom right,rgba(61,90,128,.35),rgba(152,193,217,.28));-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none}
    .card::after{content:"";position:absolute;inset:-20%;background:radial-gradient(180px circle at var(--mx,50%) var(--my,50%),rgba(152,193,217,.22),transparent 60%);opacity:0;transition:opacity .2s ease;pointer-events:none}
    .card:hover{transform:translateY(-2px);box-shadow:0 10px 30px -12px var(--card-glow)}
    .card:hover::after{opacity:1}
    .setup-card h2,.preview-card h2{margin-top:0;margin-bottom:.35rem;font-size:1.1rem;letter-spacing:-.02em}
    .preview-card p.muted{margin-top:0;margin-bottom:1.25rem;color:var(--muted);font-size:.9rem}
    .field-row{display:flex;flex-wrap:wrap;gap:.6rem;align-items:center;margin-bottom:1rem}
    .field-row input{flex:1 1 180px;min-width:0;padding:.65rem .75rem;border-radius:12px;border:1px solid rgba(255,255,255,.14);background:rgba(0,0,0,.4);color:var(--text);font:inherit;outline:none;transition:border-color .2s ease,box-shadow .2s ease,background .2s ease}
    .field-row input::placeholder{color:rgba(209,213,219,.65)}
    .field-row input:focus-visible{border-color:var(--brand-2);box-shadow:0 0 0 1px var(--brand-2);background:rgba(15,23,42,.9)}
    #out{display:none;font-size:.9rem;padding:.7rem .85rem;border-radius:10px;background:rgba(15,23,42,.9);border:1px solid rgba(148,163,184,.55);margin-bottom:.75rem;word-break:break-all}
    #out a{color:var(--brand-2);text-decoration:none;word-break:break-all}
    #out a:hover{text-decoration:underline}
    .preview-frame-wrap{margin-top:.5rem;border-radius:16px;background:linear-gradient(180deg,var(--primary-dark-1),var(--primary-dark-2));border:1px solid rgba(15,23,42,.9);overflow:hidden;position:relative;min-height:200px;max-height:200px;display:flex;align-items:stretch;justify-content:stretch}
    .preview-frame{width:100%;height:200px;border:0;display:none}
    .preview-placeholder{padding:1.2rem 1.4rem;font-size:.9rem;color:var(--muted);display:flex;flex-direction:column;gap:.4rem;justify-content:center}
    .preview-placeholder b{color:var(--text)}
    .clients-section{margin-top:1.5rem}
    .clients-label{font-size:.85rem;color:var(--muted);letter-spacing:.08em;text-transform:uppercase}
    .clients-shell{margin-top:1rem;border-radius:18px;background:linear-gradient(180deg,var(--primary-dark-1),var(--primary-dark-2));border:1px solid rgba(15,23,42,.9);overflow-x:auto;-ms-overflow-style:none;scrollbar-width:none;position:relative}
    .clients-shell::-webkit-scrollbar{display:none}
    .clients-track{display:flex;gap:18px;padding:12px 18px;min-width:max-content}
    .client-pill{display:inline-flex;align-items:center;gap:.75rem;padding:.45rem .85rem;border-radius:999px;background:rgba(15,23,42,1);border:1px solid rgba(148,163,184,.6);white-space:nowrap;font-size:.9rem}
    .client-pill img{width:32px;height:32px;border-radius:999px;object-fit:cover;flex-shrink:0}
    .client-pill strong{font-weight:600}
    .client-pill span{font-size:.8rem;color:var(--muted)}
    .antibot-overlay{position:fixed;inset:0;z-index:80;display:none;align-items:center;justify-content:center}
    .antibot-overlay.active{display:flex}
    .antibot-backdrop{position:absolute;inset:0;background:rgba(3,7,18,.78);backdrop-filter:blur(8px)}
    .antibot-dialog{position:relative;z-index:1;max-width:360px;width:90%;border-radius:18px;padding:18px 20px 14px;background:var(--card);border:1px solid rgba(148,163,184,.65);box-shadow:0 18px 45px -24px rgba(0,0,0,.9)}
    .antibot-dialog h2{margin:0 0 .4rem;font-size:1.05rem;letter-spacing:-.01em}
    .antibot-dialog p{margin:0 0 .9rem;font-size:.88rem;color:var(--muted)}
    .antibot-check{display:flex;align-items:center;gap:.5rem;font-size:.9rem;margin-bottom:1rem;cursor:pointer;user-select:none}
    .antibot-check input{width:16px;height:16px;border-radius:4px;border:1px solid rgba(148,163,184,.8);background:rgba(15,23,42,.9);accent-color:var(--brand-2)}
    .antibot-actions{display:flex;justify-content:flex-end;gap:.5rem}
    footer{border-top:1px solid rgba(255,255,255,.06);background:rgba(0,0,0,.35);padding:28px 0;margin-top:2rem}
    .foot{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:16px}
    .footer-links{justify-self:center;display:flex;gap:1rem;flex-wrap:wrap}
    .footer-brand{justify-self:start}
    .foot a{color:var(--muted);text-decoration:none}
    .foot a:hover{color:var(--text)}
    .footer-copy{justify-self:end;color:var(--muted);font-size:.95rem}
  </style>
</head>
<body id="setup">
  <div class="bg-wrap">
    <div class="bg-gradient"></div>
    <div class="bg-noise"></div>
  </div>

  <header>
    <div class="container nav">
      <a class="brand" href="index.html" aria-label="Back to home">
        <img src="logo.png" alt="timsu logo">
      </a>
      <div class="nav-links">
        <a href="index.html#features">Features</a>
        <a href="index.html#faq">FAQ</a>
      </div>
      <nav class="nav-actions">
        <a class="btn btn-primary" href="#setup">Get Started</a>
      </nav>
    </div>
  </header>

  <main class="container">
    <section class="hero" aria-label="Overlay setup">
      <div class="hero-inner">
        <div class="eyebrow" data-animate data-delay="1"><span class="dot"></span>Stream With Swag</div>
        <h1 class="title" data-animate data-delay="2">Timsu Setup</h1>
        <p class="sub" data-animate data-delay="3">Enter Your YouTube Channel ID, then add it as a Browser Source in OBS.</p>
        <div class="setup-grid" data-animate data-delay="4">
          <article class="card setup-card">
            <h2>Create a Link</h2>
            <div class="field-row">
              <input id="cid" type="text" placeholder="Enter Channel ID" autocomplete="off" />
              <button id="gen" type="button" class="btn btn-primary">Generate</button>
              <button id="copy" type="button" class="btn" disabled>Copy</button>
            </div>

            <div id="out"></div>

            <section class="clients-section" aria-label="Clients">
              <div class="clients-label">Trusted by</div>
              <div class="clients-shell" id="clientScroller">
                <div class="clients-track">
                  <div class="client-pill">
                    <img src="kreekcraft.png" alt="KreekCraft logo" loading="lazy">
                    <div><strong>KreekCraft</strong> · <span>15M subscribers</span></div>
                  </div>
                  <div class="client-pill">
                    <img src="steakwad.png" alt="Steak logo" loading="lazy">
                    <div><strong>Steak</strong> · <span>4M subscribers</span></div>
                  </div>
                  <div class="client-pill">
                    <img src="caylusblox.png" alt="CaylusBlox logo" loading="lazy">
                    <div><strong>CaylusBlox</strong> · <span>7M subscribers</span></div>
                  </div>
                  <div class="client-pill">
                    <img src="cruzlogo.png" alt="Cruz logo" loading="lazy">
                    <div><strong>Cruz</strong> · <span>1M subscribers</span></div>
                  </div>
                  <div class="client-pill">
                    <img src="kreekcraft.png" alt="KreekCraft logo" loading="lazy">
                    <div><strong>KreekCraft</strong> · <span>15M subscribers</span></div>
                  </div>
                  <div class="client-pill">
                    <img src="steakwad.png" alt="Steak logo" loading="lazy">
                    <div><strong>Steak</strong> · <span>4M subscribers</span></div>
                  </div>
                  <div class="client-pill">
                    <img src="caylusblox.png" alt="CaylusBlox logo" loading="lazy">
                    <div><strong>CaylusBlox</strong> · <span>7M subscribers</span></div>
                  </div>
                  <div class="client-pill">
                    <img src="cruzlogo.png" alt="Cruz logo" loading="lazy">
                    <div><strong>Cruz</strong> · <span>1M subscribers</span></div>
                  </div>
                </div>
              </div>
            </section>
          </article>

          <article class="card preview-card">
            <h2>Preview</h2>
            <p class="muted">Preview Your Chat Overlay.</p>
            <div class="preview-frame-wrap">
              <div class="preview-placeholder" id="previewPlaceholder">
                <b>No overlay yet</b>
                <small>Enter your Channel ID and click <em>Generate</em> to preview.</small>
              </div>
              <iframe id="previewFrame" class="preview-frame" title="Chat preview" src="" loading="lazy"></iframe>
            </div>
          </article>
        </div>
      </div>
    </section>
  </main>

  <div id="antibotOverlay" class="antibot-overlay" aria-hidden="true">
    <div class="antibot-backdrop"></div>
    <div class="antibot-dialog" role="dialog" aria-modal="true" aria-labelledby="antibotTitle">
      <h2 id="antibotTitle">Quick human check</h2>
      <p>Before we generate your overlay link, please confirm you're not a bot.</p>
      <label class="antibot-check">
        <input type="checkbox" id="antibotCheckbox">
        <span>I'm not a robot</span>
      </label>
      <div class="antibot-actions">
        <button type="button" class="btn" id="antibotCancel">Cancel</button>
        <button type="button" class="btn btn-primary" id="antibotConfirm" disabled>Continue</button>
      </div>
    </div>
  </div>

  <footer role="contentinfo">
    <div class="container foot">
      <div class="footer-brand">
        <img src="logo.png" alt="timsu logo" style="height:24px;width:auto;">
      </div>
      <div class="footer-links"></div>
      <div class="footer-copy">© <span id="year"></span> timsu. All rights reserved.</div>
    </div>
  </footer>

  <script>
    document.getElementById('year').textContent = new Date().getFullYear();

    const reduceMotionSetup = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if(reduceMotionSetup){
      document.querySelectorAll('[data-animate]').forEach(el => {
        el.style.opacity = 1;
        el.style.transform = 'none';
        el.style.animation = 'none';
      });
    }

    document.querySelectorAll('.card').forEach(card => {
      card.addEventListener('mousemove', (e) => {
        const rect = card.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        card.style.setProperty('--mx', x + 'px');
        card.style.setProperty('--my', y + 'px');
      });
    });

    const genBtn = document.getElementById("gen");
    const copyBtn = document.getElementById("copy");
    const out = document.getElementById("out");
    const cidInput = document.getElementById("cid");
    const previewFrame = document.getElementById("previewFrame");
    const previewPlaceholder = document.getElementById("previewPlaceholder");

    const antibotOverlay = document.getElementById("antibotOverlay");
    const antibotCheckbox = document.getElementById("antibotCheckbox");
    const antibotConfirm = document.getElementById("antibotConfirm");
    const antibotCancel = document.getElementById("antibotCancel");

    let lastUrl = "";
    let humanVerified = false;

    function setCopyEnabled(enabled) {
      copyBtn.disabled = !enabled;
      if (!copyBtn.textContent.trim()) copyBtn.textContent = "Copy";
    }

    async function copyToClipboard(text) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        try {
          const ta = document.createElement("textarea");
          ta.value = text;
          ta.setAttribute("readonly", "");
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
          return true;
        } catch {
          return false;
        }
      }
    }

    function updatePreview(url) {
      if (!url) {
        previewFrame.removeAttribute("src");
        previewFrame.style.display = "none";
        previewPlaceholder.style.display = "flex";
        return;
      }
      previewFrame.src = url;
      previewFrame.style.display = "block";
      previewPlaceholder.style.display = "none";
    }

    function generate() {
      const cid = cidInput.value.trim();
      if (!cid) {
        out.style.display = "none";
        setCopyEnabled(false);
        updatePreview("");
        return;
      }

      const base = location.origin;
      lastUrl = `${base}/overlay/${encodeURIComponent(cid)}`;

      out.style.display = "block";
      out.innerHTML = `<div><b>Overlay URL</b><br><a href="${lastUrl}" target="_blank" rel="noopener">${lastUrl}</a></div>`;
      setCopyEnabled(true);
      updatePreview(lastUrl);
    }

    async function onCopy() {
      if (!lastUrl) return;
      const ok = await copyToClipboard(lastUrl);
      if (ok) {
        const old = copyBtn.textContent;
        copyBtn.textContent = "Copied!";
        setTimeout(() => (copyBtn.textContent = old || "Copy"), 1200);
      }
    }

    function openAntibot(){
      antibotOverlay.classList.add("active");
      antibotOverlay.setAttribute("aria-hidden","false");
      antibotCheckbox.checked = false;
      antibotConfirm.disabled = true;
    }
    function closeAntibot(){
      antibotOverlay.classList.remove("active");
      antibotOverlay.setAttribute("aria-hidden","true");
    }

    antibotCheckbox.addEventListener("change", () => {
      antibotConfirm.disabled = !antibotCheckbox.checked;
    });

    antibotCancel.addEventListener("click", () => {
      closeAntibot();
    });

    antibotConfirm.addEventListener("click", () => {
      if (!antibotCheckbox.checked) return;
      humanVerified = true;
      closeAntibot();
      generate();
    });

    antibotOverlay.addEventListener("click", (e) => {
      if (e.target === antibotOverlay || e.target.classList.contains("antibot-backdrop")) {
        closeAntibot();
      }
    });

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && antibotOverlay.classList.contains("active")) {
        closeAntibot();
      }
    });

    genBtn.addEventListener("click", () => {
      if (!humanVerified) openAntibot();
      else generate();
    });

    copyBtn.addEventListener("click", onCopy);

    cidInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        if (!humanVerified) openAntibot();
        else generate();
      }
    });

    setCopyEnabled(false);
    updatePreview("");

    (function(){
      const shell = document.getElementById('clientScroller');
      if(!shell) return;
      const track = shell.querySelector('.clients-track');
      if(!track) return;

      let isHover = false;
      let lastTime = null;
      let scrollPos = 0;
      let loopWidth = 0;

      function recalcLoop(){
        loopWidth = track.scrollWidth / 2;
      }
      recalcLoop();
      window.addEventListener('resize', recalcLoop);

      shell.addEventListener('mouseenter', () => {
        isHover = true;
        scrollPos = shell.scrollLeft;
      });
      shell.addEventListener('mouseleave', () => {
        isHover = false;
        scrollPos = shell.scrollLeft;
      });

      if(reduceMotionSetup) return;

      function step(ts){
        if(lastTime == null) lastTime = ts;
        const dt = ts - lastTime;
        lastTime = ts;

        if(!isHover){
          const speed = 0.03;
          scrollPos += dt * speed;
          if(loopWidth > 0 && scrollPos >= loopWidth){
            scrollPos -= loopWidth;
          }
          shell.scrollLeft = scrollPos;
        } else {
          scrollPos = shell.scrollLeft;
        }
        requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    })();
  </script>
</body>
</html>
