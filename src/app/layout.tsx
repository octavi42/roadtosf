import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import SessionHydrator from "@/components/SessionHydrator";
import DevPanel from "@/components/DevPanel";
import UsageWidget from "@/components/UsageWidget";

// Chicago Kare — faithful 1984 Susan Kare Chicago bitmap reproduction.
// MIT-licensed, https://github.com/KingDuane/Chicago-Kare
// Used as the single typeface across the entire app.
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
      className={`${chicagoKare.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-fog text-ink overflow-hidden">
        <SessionHydrator />
        {children}
        <UsageWidget />
        <DevPanel />
      </body>
    </html>
  );
}
