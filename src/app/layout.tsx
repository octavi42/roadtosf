import type { Metadata } from "next";
import { Geist, Geist_Mono, Pixelify_Sans, VT323 } from "next/font/google";
import "./globals.css";
import SessionHydrator from "@/components/SessionHydrator";
import DevPanel from "@/components/DevPanel";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const pixelifySans = Pixelify_Sans({
  variable: "--font-pixelify",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const vt323 = VT323({
  variable: "--font-vt323",
  subsets: ["latin"],
  weight: ["400"],
});

export const metadata: Metadata = {
  title: "Road to SF",
  description: "Your personalized Silicon Valley founder story",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${pixelifySans.variable} ${vt323.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-fog text-ink overflow-hidden">
        <SessionHydrator />
        {children}
        <DevPanel />
      </body>
    </html>
  );
}
