import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Dial Desk", template: "%s · Dial Desk" },
  description: "Call queue and pipeline for the tele-sales team.",
  applicationName: "Dial Desk",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f6f7f9",
  colorScheme: "light",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={geistSans.variable}>
      <body>
        <a href="#main" className="skip-link">Skip to content</a>
        {children}
      </body>
    </html>
  );
}
