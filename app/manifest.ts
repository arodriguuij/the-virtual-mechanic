import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Motor Metabólico",
    short_name: "Motor Metabólico",
    description:
      "Planificador de nutrición y fisiología para ciclistas — fueling y recuperación a partir de tu FTP, peso y datos reales de Strava.",
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
