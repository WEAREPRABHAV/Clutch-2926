import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CLUTCH / 26 — Esports Championship",
  description: "CLUTCH / 26 esports championship",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
