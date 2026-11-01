import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
export const metadata: Metadata = {
  title: "Iligan Connect · Community operations",
  description: "Community reporting, geographic assessment and coordination",
  icons: { icon: "/iligan-connect-logo.png" },
};
export default async function Layout({ children }: { children: React.ReactNode }) {
  await headers();
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
