import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "just-bash",
  description: "A sandboxed bash interpreter for AI agents. Pure TypeScript with in-memory filesystem.",
  metadataBase: new URL("https://just-bash.vercel.app"),
  openGraph: {
    title: "just-bash",
    description: "A sandboxed bash interpreter for AI agents. Pure TypeScript with in-memory filesystem.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "just-bash",
    description: "A sandboxed bash interpreter for AI agents. Pure TypeScript with in-memory filesystem.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${GeistMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
