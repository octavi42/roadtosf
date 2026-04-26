import type { Metadata } from "next";
import { Geist, Geist_Mono, VT323 } from "next/font/google";
import localFont from "next/font/local";
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

// Chicago Kare — faithful 1984 Susan Kare Chicago bitmap reproduction.
// MIT-licensed, https://github.com/KingDuane/Chicago-Kare
const chicagoKare = localFont({
  src: [
    {
      path: "../../public/fonts/ChicagoKare-Regular.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../public/fonts/ChicagoKare-Regular.woff",
      weight: "400",
      style: "normal",
    },
  ],
  variable: "--font-chicago",
  display: "swap",
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
      className={`${geistSans.variable} ${geistMono.variable} ${chicagoKare.variable} ${vt323.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-fog text-ink overflow-hidden">
        <SessionHydrator />
        {children}
        <DevPanel />
      </body>
    </html>
  );
}
