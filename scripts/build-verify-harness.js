/**
 * Build a fully self-contained verification harness from dist/: inlines all
 * JS chunks (webpack lazy chunks self-register via webpackChunk.push) and
 * CSS, and stubs fetch() for /data/* so the SPA runs without a server.
 * Output goes to .verify-tmp/ (gitignored).
 */
const fs = require("fs");
const path = require("path");

const dist = path.resolve(__dirname, "..", "dist");
const outDir = path.resolve(__dirname, "..", ".verify-tmp");
fs.mkdirSync(outDir, { recursive: true });

const jsFiles = fs.readdirSync(dist).filter((f) => f.endsWith(".js"));
const cssFile = fs.readdirSync(dist).find((f) => f.endsWith(".css"));

// Inline data files as base64 so the in-browser fetch stub can serve them.
const dataDir = path.join(dist, "data");
const dataFiles = fs
  .readdirSync(dataDir)
  .filter((f) => fs.statSync(path.join(dataDir, f)).isFile());
const dataMap = {};
for (const f of dataFiles) {
  dataMap["/data/" + f] = fs.readFileSync(path.join(dataDir, f)).toString("base64");
}

const inlineScripts = jsFiles
  .map((f) => `<script>${fs.readFileSync(path.join(dist, f), "utf8")}</script>`)
  .join("\n");

const fetchStub = `<script>
(function () {
  const realFetch = window.fetch ? window.fetch.bind(window) : null;
  const DATA = ${JSON.stringify(dataMap)};
  window.__fetchedUrls = [];
  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    window.__fetchedUrls.push(url);
    if (url.indexOf("/data/") === 0) {
      const name = url.split("/data/")[1].split("?")[0];
      const b64 = DATA["/data/" + name];
      if (b64) {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        return Promise.resolve(new Response(bytes, { status: 200 }));
      }
      return Promise.resolve(new Response("not found", { status: 404 }));
    }
    return realFetch ? realFetch(input, init) : Promise.reject(new Error("no fetch"));
  };
})();
</script>`;

const inlineCss = `<style>${fs.readFileSync(path.join(dist, cssFile), "utf8")}</style>`;

// <img> is a plain HTTP request, not a fetch(), so the stub above can't help
// it and the harness 404s on every picture. Inline the built images as data
// URLs and rewrite any <img> that points at one, including ones the app adds
// later via innerHTML.
const IMAGE_RE = /\.(png|jpe?g|gif|webp|avif|svg)$/i;
const MIME = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
};
const imageMap = {};
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (IMAGE_RE.test(entry.name)) {
      const ext = entry.name.split(".").pop().toLowerCase();
      const served = "/" + path.relative(dist, full).split(path.sep).join("/");
      imageMap[served] =
        `data:${MIME[ext] || "application/octet-stream"};base64,` +
        fs.readFileSync(full).toString("base64");
    }
  }
})(dist);

const imageScript = `<script>
(function () {
  var MAP = ${JSON.stringify(imageMap)};
  function fix(el) {
    if (!el || !el.getAttribute) return;
    var s = el.getAttribute("src");
    if (s && MAP[s]) el.setAttribute("src", MAP[s]);
  }
  new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) {
      var m = muts[i];
      if (m.type === "attributes") { fix(m.target); continue; }
      for (var j = 0; j < m.addedNodes.length; j++) {
        var n = m.addedNodes[j];
        if (n.nodeType !== 1) continue;
        if (n.tagName === "IMG") fix(n);
        var inner = n.querySelectorAll ? n.querySelectorAll("img[src]") : [];
        for (var k = 0; k < inner.length; k++) fix(inner[k]);
      }
    }
  }).observe(document.documentElement, {
    childList: true, subtree: true, attributes: true, attributeFilter: ["src"],
  });
  document.querySelectorAll("img[src]").forEach(fix);
})();
</script>`;

let html = fs.readFileSync(path.join(dist, "index.html"), "utf8");
// Drop external script/style references. The fetch stub goes in <head> so it
// wraps fetch before the app boots; the bundle goes before </body> (matching
// HtmlWebpackPlugin's real placement, where document.body already exists).
html = html.replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, "");
html = html.replace(/<link[^>]*href="[^"]*\.css"[^>]*>/g, "");
// NOTE: the replacement must be a function, never a string. Minified bundles
// routinely contain `$&`, `` $` `` and `$'`, which String.replace() expands as
// capture patterns — that silently rewrites the inlined JS and the page dies
// with an unrelated SyntaxError.
html = html.replace("</head>", () => `${fetchStub}\n${imageScript}\n${inlineCss}</head>`);
html = html.replace("</body>", () => `${inlineScripts}</body>`);

const outPath = path.join(outDir, "harness.html");
fs.writeFileSync(outPath, html);

// ----------------------------------------------------------------------
// Viewport rig.
//
// The harness has to be driven at more than one width (the layout has 600px
// and 768px breakpoints), and the only file a static host will serve is the
// one that was registered. So this file serves as both: top-level it draws
// the rig, and framed it document.write()s the harness into itself and
// becomes the app. Framed copies keep the real /rig.html URL, which matters
// because the router reads location.pathname and pushes state.
// ----------------------------------------------------------------------
const rigPath = path.join(outDir, "viewports.html");
const harnessB64 = Buffer.from(html, "utf8").toString("base64");
const rig = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Viewport rig</title>
<style>
  :root { color-scheme: dark; }
  html, body { margin: 0; background: #0f1114; }
  body { font: 11px/1.5 -apple-system, BlinkMacSystemFont, system-ui, sans-serif; color: #8b93a1; padding: 10px 12px 40px; }
  h1 { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: #5f6875; margin: 4px 0 10px; font-weight: 600; }
  .label { letter-spacing: .06em; text-transform: uppercase; color: #6b7480; margin: 12px 0 6px; }
  .label b { color: #aab3c0; font-weight: 600; }
  .slot { overflow: hidden; border: 1px solid #2c313a; position: relative; }
  .slot iframe { border: 0; position: absolute; top: 0; left: 0; transform-origin: top left; background: #fff; }
  #rig[hidden] { display: none; }
</style>
</head>
<body>
  <h1>Viewport rig</h1>
  <div id="rig"></div>

  <!-- The harness itself, inert until a frame needs it. -->
  <script id="harness-b64" type="application/octet-stream">${harnessB64}</script>

  <script>
  (function () {
    function harnessHtml() {
      var raw = atob(document.getElementById("harness-b64").textContent.trim());
      var bytes = new Uint8Array(raw.length);
      for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      return new TextDecoder().decode(bytes);
    }

    // Framed: throw away the rig and become the app.
    if (window.self !== window.top) {
      document.open();
      document.write(harnessHtml());
      document.close();
      return;
    }

    var rigEl = document.getElementById("rig");

    window.__rig = {
      /** Create a viewport of a given CSS size, optionally scaled to fit. */
      add: function (id, w, h, scale) {
        var old = document.getElementById("slot-" + id);
        if (old) old.remove();
        scale = scale || 1;
        var label = document.createElement("div");
        label.className = "label";
        label.innerHTML = "<b>" + id + "</b> " + w + " \u00d7 " + h +
          (scale === 1 ? "" : " (shown at " + Math.round(scale * 100) + "%)");
        var slot = document.createElement("div");
        slot.className = "slot";
        slot.id = "slot-" + id;
        slot.style.width = Math.round(w * scale) + "px";
        slot.style.height = Math.round(h * scale) + "px";
        var frame = document.createElement("iframe");
        frame.id = id;
        frame.style.width = w + "px";
        frame.style.height = h + "px";
        frame.style.transform = "scale(" + scale + ")";
        frame.src = "viewports.html";
        slot.appendChild(frame);
        rigEl.appendChild(label);
        rigEl.appendChild(slot);
        return new Promise(function (resolve) {
          frame.addEventListener("load", function () {
            setTimeout(function () { resolve(window.__rig.doc(id) ? "ready" : "empty"); }, 150);
          }, { once: true });
        });
      },
      doc: function (id) {
        var f = document.getElementById(id);
        try { return f && f.contentDocument && f.contentDocument.querySelector("#app") ? f.contentDocument : null; } catch (e) { return null; }
      },
      win: function (id) { return document.getElementById(id).contentWindow; },
      /** SPA-navigate a viewport the way a link click would. */
      go: function (id, p) {
        var w = window.__rig.win(id);
        w.history.pushState({}, "", p);
        w.dispatchEvent(new w.PopStateEvent("popstate"));
        return new Promise(function (r) { setTimeout(r, 900); });
      },
      remove: function (id) { var s = document.getElementById("slot-" + id); if (s) s.remove(); },
      hide: function () { rigEl.hidden = true; },
      show: function () { rigEl.hidden = false; }
    };
  })();
  </script>
</body>
</html>
`;
fs.writeFileSync(rigPath, rig);
console.log(
  `Harness written: ${outPath} (${jsFiles.length} js chunks, ${dataFiles.length} data files, ${Object.keys(imageMap).length} images inlined)`
);
console.log(`Rig written:     ${rigPath}`);
