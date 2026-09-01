export interface Note {
  id: string;
  title: string;
  content: string;
  readingTime: string;
  githubLink?: string;
  publishDate: string;
  tags: string[];
  contentPath?: string;
  blogLink: string;
  links?: Array<{ url: string; description: string }>;
  pinned?: boolean;
  hidden?: boolean;
  /**
   * Which deployments this note is published to: `["github"]` for
   * `*.github.io` only, `["pages"]` for the Cloudflare copy (`*.pages.dev` or
   * a custom domain), `["github", "pages"]` for both, `["*"]` for everywhere,
   * `[]` for nowhere. Omit the field for every site. A note left off a site is
   * unreachable there — link included.
   */
  sites?: string[];
}
