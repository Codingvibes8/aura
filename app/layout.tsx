import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ServiceWorkerRegister } from "@/components/sw-register";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Aura — Accessible Real-Time Communication",
  description:
    "Ultra-low-latency live captions, ambient sound alerts, and on-demand interpreters — bridging conversations between the Deaf/Hard-of-Hearing community and hearing individuals.",
  applicationName: "Aura",
  appleWebApp: {
    capable: true,
    title: "Aura",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#4f46e5",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-background font-sans text-foreground">
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}
