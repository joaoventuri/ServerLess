import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ServerLess — Infrastructure Command Center",
  description: "Unified server management, credential vault, monitoring & cloud IDE",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
