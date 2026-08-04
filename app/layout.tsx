import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://www.ratiovelo.com"),
  title: {
    default: "RATIO · Nutrición Ciclista",
    template: "%s | RATIO",
  },
  description:
    "Calculadora y planificador de nutrición de precisión en ruta para ciclistas. Optimización de carbohidratos, hidratación y sodio.",
  keywords: [
    "ciclismo",
    "nutrición ciclista",
    "ratio velo",
    "carbohidratos ciclismo",
    "avituallamiento",
    "strava",
    "vatios",
    "plan de nutrición",
  ],
  authors: [{ name: "RATIO Team" }],
  creator: "RATIO",
  publisher: "RATIO Velo",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  alternates: {
    canonical: "https://www.ratiovelo.com",
  },
  appleWebApp: {
    title: "RATIO",
    statusBarStyle: "default",
  },
  openGraph: {
    title: "RATIO · Nutrición Ciclista de Precisión",
    description:
      "Optimiza tu avituallamiento en ruta según tus vatios, tasa de sudor y consumo de glucógeno.",
    url: "https://www.ratiovelo.com",
    siteName: "RATIO Velo",
    locale: "es_ES",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "RATIO · Nutrición Ciclista",
    description: "Calculadora y planificador de nutrición de precisión en ruta para ciclistas.",
    creator: "@ratiovelo",
  },
  robots: {
    index: true,
    follow: true,
  },
};

// The porcelain `--background` token's own literal value — matches the
// warm cream canvas every page (and every card) sits on, so iOS Safari's
// status bar (clock/battery) reads as a continuation of the page itself.
// Briefly flipped to pure `#FFFFFF` to match the mobile sticky header's own
// `bg-white` (`components/dashboard-shell.tsx`) once that header stopped
// blending with the page — reverted back to porcelain on a later, explicit
// request: the header itself stays white (its own shadow is what separates
// it from the page now, not a matching status-bar tone), but the status
// bar syncs with the canvas beneath it instead.
//
// `viewportFit: "cover"` is what actually lets this app's own canvas paint
// underneath iOS Safari's safe-area insets (the notch/status-bar strip at
// top, the home-indicator strip at bottom) instead of Safari filling those
// strips with its own default white — `themeColor` alone only recolors
// Safari's own floating chrome, it doesn't extend this app's content behind
// it. Without this, the two porcelain tones (this app's `#F8F7F5` content
// area vs. whatever Safari's chrome renders in those insets) can still show
// a visible seam even when `themeColor` is set correctly. No `env(safe-
// area-inset-*)` padding has been added to any fixed-position UI yet (the
// bottom-fixed `Toast` component, `components/toast.tsx`, is the one
// element that could end up flush against the home-indicator strip once
// content extends under it) — flagged here rather than silently expanding
// this change's scope; add that padding if a toast is ever reported
// sitting too close to the bottom edge on a real notched/home-indicator
// device.
// `colorScheme: "light"` emits the actual `<meta name="color-scheme"
// content="light">` tag — a separate signal from `globals.css`'s own CSS
// `color-scheme: light` declaration on `:root`. Safari reads both, but the
// meta tag is available to it before the stylesheet has even loaded, which
// is exactly the window (first paint, and the instant right after a
// client-side route transition) where the floating "pill" toolbar has
// historically been most likely to fall back to its opaque bar state on a
// device in system Dark Mode.
export const viewport: Viewport = {
  themeColor: "#F8F7F5",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  colorScheme: "light",
};

// Structured data (schema.org WebApplication) for Google's rich-result
// eligibility — plain module-level data, not derived from anything
// per-request, so it's safe to stringify once here rather than recomputing
// it inside the component body on every render.
const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "RATIO Velo",
  url: "https://www.ratiovelo.com",
  applicationCategory: "HealthApplication",
  operatingSystem: "All",
  description: "Calculadora y planificador de nutrición de precisión en ruta para ciclistas.",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "EUR",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} min-h-dvh bg-background antialiased`}
    >
      {/* `min-h-dvh` (not `h-full`/`min-h-full`, which depend on the
          ancestor chain propagating a real height down from the true
          viewport) on both `html` and `body` — the dynamic-viewport-height
          unit that actually accounts for iOS Safari's own collapsing/
          expanding toolbar, so the porcelain canvas fills the real visible
          area from first paint instead of a stale `100vh` reading leaving
          a gray gap once the toolbar animates. `bg-background` stays the
          design-system token rather than a hardcoded `#F8F7F5` literal —
          same value (see the token's own comment above `viewport`), this
          app's own "reuse the token, never hardcode the hex" convention. */}
      {/* "Fix Definitivo de CSS position: sticky" — `overflow-x-hidden` used
          to live here (a defensive backstop against a stray wide/absolutely-
          positioned descendant causing a horizontal pan on iOS Safari — see
          the matching `html, body` rule this once paired with in
          `app/globals.css`). Removed outright: any non-`visible` value on
          either `overflow-x`/`overflow-y` of the root `<html>`/`<body>`
          forces the *other* axis to compute to `auto` too (a CSS Overflow
          Module rule, not a bug), which makes both elements genuine scroll
          containers distinct from "the viewport" as far as `position:
          sticky`'s own containing-block search is concerned — verified live
          (a temporary Playwright scroll test): every `position: sticky`
          element in this app, not just this one, silently stopped sticking
          and scrolled away with the page the instant this was set, with
          zero visual/console indication anything was wrong. This is the
          exact same root cause `components/dashboard-shell.tsx`'s own
          header comment already diagnosed once (and worked around locally
          by switching that one header to `fixed`) — removing it here fixes
          every current and future `sticky` element at the source instead of
          requiring a per-component `fixed`-position workaround each time one
          is discovered. `max-width: 100%` (`app/globals.css`) stays as the
          remaining horizontal-overflow guard — the actual per-component
          overflow bugs this was ever meant to catch were already fixed at
          the layout level (per this rule's own prior comment), so this was
          strictly a "belt and suspenders" duplicate, not load-bearing. */}
      <body className="flex min-h-dvh flex-col bg-background text-foreground">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        {/* Persistent porcelain wrapper — a plain `<div>`, not a second
            `<main>` (every route under `(app)` already renders its own
            `<main>` inside `DashboardShell`, and nested `<main>` landmarks
            are invalid HTML). Its only job is to guarantee the porcelain
            background repaints immediately underneath whatever the App
            Router swaps in during a client-side navigation between routes,
            rather than relying solely on `<body>`'s own background a level
            higher — belt-and-suspenders against a transparent frame iOS
            Safari's floating toolbar could otherwise read as "opaque bar"
            territory for. */}
        <div className="min-h-dvh w-full flex-1 bg-background">{children}</div>
      </body>
    </html>
  );
}
