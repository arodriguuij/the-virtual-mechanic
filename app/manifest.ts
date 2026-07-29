import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "RATIO",
    short_name: "RATIO",
    description:
      "Planificador de nutrición y fisiología para ciclistas — alimentación y recuperación a partir de tu FTP, peso y datos reales de Strava.",
    start_url: "/",
    display: "standalone",
    background_color: "#faf9f5",
    theme_color: "#faf9f5",
    icons: [
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
