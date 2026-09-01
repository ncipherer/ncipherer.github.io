/**
 * Where this copy of the site is being read from.
 *
 * The same `dist/` is published twice — once to GitHub Pages, once to
 * Cloudflare Pages — so "which notes belong on this site" cannot be decided at
 * build time. It is decided here, from the host the reader actually arrived on,
 * and `services/note.ts` drops everything that does not belong to it before any
 * page ever sees the list. A note left off a site is not merely unlisted:
 * `getNoteByBlogLink` cannot find it either, so a direct link lands on the
 * site's 404 page instead of a page that was meant for somewhere else.
 *
 * The Cloudflare copy may be served from a custom domain, so the host is not
 * matched against `*.pages.dev` alone: anything public that is not
 * `*.github.io` reads as that copy — see `currentSite`.
 */

/** The deployments a note can be restricted to. */
export type SiteKey = "github" | "pages";

/**
 * Spellings accepted in `notes.json`, so the field can be written the way the
 * host reads. `"*"` (or `"all"`) means every site.
 */
const SITE_ALIASES: Record<string, SiteKey | "*"> = {
  github: "github",
  "github.io": "github",
  gh: "github",
  pages: "pages",
  "pages.dev": "pages",
  cloudflare: "pages",
  cf: "pages",
  "*": "*",
  all: "*",
};

/*
 * Custom domains pinned by hand to the deployment that serves them — for the
 * day a hostname alone is not enough (say the GitHub copy grows a CNAME).
 * Keys are bare hostnames; `www.` is matched automatically. An empty table is
 * the normal case: every other non-platform host falls through to the default
 * in `currentSite`.
 */
const CUSTOM_HOST_SITES: Record<string, SiteKey> = {};

/**
 * Hosts that are the author's own machine rather than a deployment: no note
 * is ever hidden from them. Localhost, IP literals and the offline verify
 * harness all land here.
 */
function isLocalHost(host: string): boolean {
  if (!host || host === "localhost" || host.endsWith(".localhost")) return true;
  // .local is reserved for mDNS previews; a colon can only be an IPv6
  // literal (IPv4 literals match the dotted-quad test).
  if (host.endsWith(".local")) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  return host.includes(":");
}

/**
 * The site this copy is served from, or `null` when the host is not a
 * deployment at all — localhost, an IP literal, the offline verify harness —
 * so the author sees everything while writing.
 *
 * `*.github.io` and `*.pages.dev` name themselves, but the Cloudflare copy may
 * be served from a custom domain, where the suffix says nothing. The GitHub
 * copy is only ever published under `github.io`, so a public host that names
 * neither platform is treated as the Cloudflare deployment: visibility fails
 * *closed* on an unknown domain instead of leaking every `github`-only note
 * there. `CUSTOM_HOST_SITES` overrides that reading for any host where it is
 * wrong.
 */
export function currentSite(hostname?: string): SiteKey | null {
  const host = (
    hostname ?? (typeof location !== "undefined" ? location.hostname : "")
  )
    .toLowerCase()
    .replace(/\.$/, "");

  if (isLocalHost(host)) return null;
  if (host === "github.io" || host.endsWith(".github.io")) return "github";
  if (host === "pages.dev" || host.endsWith(".pages.dev")) return "pages";

  const bare = host.replace(/^www\./, "");
  const pinned = CUSTOM_HOST_SITES[host] ?? CUSTOM_HOST_SITES[bare];
  if (pinned) return pinned;

  // A custom domain serving this dist: the Cloudflare deployment.
  return "pages";
}

/** One spelling → a known key, or `null` when it means nothing here. */
function toSiteKey(value: string): SiteKey | "*" | null {
  return SITE_ALIASES[value.trim().toLowerCase()] ?? null;
}

/**
 * Whether a note may be shown on the given site.
 *
 * - no `sites` field           → every site (the default; nothing changes)
 * - `"sites": ["github"]`      → only `*.github.io`
 * - `"sites": ["pages"]`       → only the Cloudflare copy: `*.pages.dev` or
 *                                 whatever custom domain it is served from
 * - `"sites": ["github", "pages"]` → both
 * - `"sites": ["*"]`           → every site
 * - `"sites": []`              → nowhere: a hard off switch that keeps the entry
 * - a non-deployment host (`null`) → every site, so nothing is missing in dev
 *
 * A misspelled entry is ignored rather than read as "nowhere", so one typo can
 * never silently unpublish a note from *every* site.
 */
export function noteVisibleOnSite(
  sites: readonly string[] | undefined | null,
  site: SiteKey | null,
): boolean {
  if (sites == null) return true;
  if (site === null) return true;
  const keys = sites
    .map(toSiteKey)
    .filter((key): key is SiteKey | "*" => key !== null);
  if (!sites.length) return false;
  if (!keys.length) return true;
  if (keys.includes("*")) return true;
  return keys.includes(site);
}
