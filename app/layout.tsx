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
    default: "RATIO — Nutrición Ciclista de Precisión",
    template: "%s | RATIO",
  },
  description:
    "Calculadora y planificador de nutrición de precisión en ruta para ciclistas. Optimización de carbohidratos, hidratación y sodio calibrado según intensidad y temperatura.",
  keywords: [
    "ciclismo",
    "nutrición ciclista",
    "ratio velo",
    "carbohidratos ciclismo",
    "avituallamiento",
    "strava",
    "vatios",
    "plan de nutrición",
    "sa calobra",
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
    title: "RATIO — Nutrición Ciclista de Precisión",
    description:
      "Optimiza tu avituallamiento en ruta según tus vatios, tasa de sudor y consumo de glucógeno.",
    url: "https://www.ratiovelo.com",
    siteName: "RATIO Velo",
    locale: "es_ES",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "RATIO — Nutrición Ciclista de Precisión",
    description: "Calculadora y planificador de nutrición de precisión en ruta para ciclistas.",
    creator: "@ratiovelo",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  themeColor: "#faf9f5",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col overflow-x-hidden bg-background text-foreground">
        {children}
      </body>
    </html>
  );
}
