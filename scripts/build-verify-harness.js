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

let html = fs.readFileSync(path.join(dist, "index.html"), "utf8");
// Drop external script/style references. The fetch stub goes in <head> so it
// wraps fetch before the app boots; the bundle goes before </body> (matching
// HtmlWebpackPlugin's real placement, where document.body already exists).
html = html.replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, "");
html = html.replace(/<link[^>]*href="[^"]*\.css"[^>]*>/g, "");
html = html.replace("</head>", `${fetchStub}\n${inlineCss}</head>`);
html = html.replace("</body>", `${inlineScripts}</body>`);

const outPath = path.join(outDir, "harness.html");
fs.writeFileSync(outPath, html);
console.log(
  `Harness written: ${outPath} (${jsFiles.length} js chunks, ${dataFiles.length} data files inlined)`
);
