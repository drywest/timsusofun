<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>YT Chat Overlay</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html, body { margin:0; padding:0; height:100%; background:transparent; }
      * { font-family: "Noto Sans","Apple Color Emoji","Noto Sans Emoji","Noto Color Emoji",Tahoma,Geneva,Verdana,sans-serif !important; }

      :root{
        --line-gap:10px;
        --font-size:42px;
        --shadow:0 3px 0 rgba(0,0,0,.45), 0 10px 24px rgba(0,0,0,.28);
        --enter-ms:40ms;          /* new line micro fade/slide */
        --push-ms:140ms;          /* j-chat push-up */
        --emoji-scale:1.42;       /* ~142% visual size for native emoji */
        --max-keep:400;
      }

      .stack{
        position:absolute; inset:0;
        display:flex; flex-direction:column; justify-content:flex-end;
        padding:18px; gap:var(--line-gap);
        overflow:hidden;
        will-change: transform;
        transition: transform var(--push-ms) ease-out;
      }

      .line{
        display:block;
        font-size:var(--font-size);
        line-height:1.12;
        font-weight:900;
        letter-spacing:.2px;
        color:#fff !important;
        text-shadow:var(--shadow);
        white-space:normal; word-break:break-word;

        opacity:0; transform:translateY(8px);
        transition: transform var(--enter-ms) ease-out, opacity var(--enter-ms) ease-out;
      }
      .line.enter{ transform:translateY(0); opacity:1; }

      .author{ font-weight:900; margin-right:.25em; }
      .message{ font-weight:900; color:#fff !important; }

      /* YouTube emoji <img> */
      .emoji{ height:1em; vertical-align:-0.15em; display:inline-block; }

      /* Native (Unicode) emoji wrapper — fixed box that centers the scaled glyph */
      .emoji-char{
        display:inline-flex;
        align-items:center;
        justify-content:center;
        width:1em;
        height:1em;
        line-height:1;
        font-size:1em;           /* base before scaling */
        font-weight:400;         /* avoid bold inflation */
        font-family:"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji";
        vertical-align:-0.15em;  /* matches image emoji baseline */
        /* add symmetric space so scaled glyph doesn't overlap neighbors */
        margin: 0 calc((var(--emoji-scale) - 1) * 0.5em);
      }
      .emoji-char .emoji-inner{
        display:block;
        transform: scale(var(--emoji-scale));
        transform-origin: center center;
      }
    </style>
  </head>
  <body>
    <div id="stack" class="stack"></div>
    <script src="/overlay.js"></script>
  </body>
</html>
