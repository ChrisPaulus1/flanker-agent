import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Flanker — Competitive Intelligence",
  description:
    "Autonomous competitive-intelligence agent tracking FinTech app releases, with strategic analysis and counter-PRDs.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // suppressHydrationWarning is required: next-themes writes the theme class
    // onto <html> before React hydrates, which is a deliberate mismatch.
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans`}>
        {/*
          Defaults to light rather than system. The light palette is the
          designed default; inheriting a dark OS setting meant most visitors
          never saw it. The toggle still switches and the choice persists.
        */}
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
