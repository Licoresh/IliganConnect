import type { Metadata } from "next";
import { headers } from "next/headers";
import { Inter, Public_Sans } from "next/font/google";
import "./globals.css";

// Inter for interface text; Public Sans (civic, government-service face) for titles, headings and large numbers. Self-hosted at build.
const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const display = Public_Sans({ subsets: ["latin"], variable: "--font-display", display: "swap" });
export const metadata: Metadata = {
  title: "Iligan Connect · Community operations",
  description: "Community reporting, geographic assessment and coordination",
  icons: { icon: "/iligan-connect-badge.png" },
};
export default async function Layout({ children }: { children: React.ReactNode }) {
  await headers();
  return (
    <html lang="en" className={`${sans.variable} ${display.variable}`}>
      <body>{children}</body>
    </html>
  );
}
