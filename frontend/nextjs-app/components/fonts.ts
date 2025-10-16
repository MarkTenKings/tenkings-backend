import { Inter, Bebas_Neue, Metal_Mania } from "next/font/google";

export const bodyFont = Inter({
  subsets: ["latin"],
  variable: "--font-body",
});

export const displayFont = Bebas_Neue({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-display",
});

export const lightningFont = Metal_Mania({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-lightning",
});
