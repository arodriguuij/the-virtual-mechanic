import type { MetadataRoute } from "next";

// Disallows `/api/` (no SEO value, and every route there either requires auth
// or is a Strava OAuth handshake step — nothing a crawler should index) while
// leaving every other path allowed; `proxy.ts`'s own auth redirect is what
// actually keeps a crawler out of the authenticated app, not this file.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/"],
    },
    sitemap: "https://www.ratiovelo.com/sitemap.xml",
  };
}
