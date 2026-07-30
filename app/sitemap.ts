import type { MetadataRoute } from "next";

const baseUrl = "https://www.ratiovelo.com";

// Only the routes actually reachable with no session at all (see
// `PUBLIC_PATH_PREFIXES` in `proxy.ts`) belong here — every other route
// (`/`, `/perfil`, `/estadisticas`, `/historial`) requires a real signed-in
// athlete and renders per-user data, so it has no public SEO value and an
// anonymous crawler hitting it just gets redirected to `/login` anyway.
// `/auth/callback` is excluded too — a transient OAuth-transition screen
// with single-use tokens, not a page anyone should land on directly.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1.0,
    },
    {
      url: `${baseUrl}/login`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.9,
    },
    {
      url: `${baseUrl}/privacidad`,
      lastModified: new Date(),
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}
