import type { Metadata, Viewport } from "next";
import { Barlow, Barlow_Condensed, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { TabBar } from "@/components/tab-bar";

// Families and weights come from the Figma Make source, src/styles/fonts.css.
// Loaded via next/font so they are self-hosted rather than render-blocking
// round trips to Google - the app runs on field wifi.

const barlow = Barlow({
  variable: "--font-barlow",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const barlowCondensed = Barlow_Condensed({
  variable: "--font-barlow-condensed",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

export const metadata: Metadata = {
  title: "Big Board",
  description: "Flag football tryout evaluation",
};

// Used one-handed outdoors. Lock the zoom so a mis-tap near a slider
// does not pinch-zoom the board, and paint the chrome to match.
export const viewport: Viewport = {
  themeColor: "#080D1A",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${barlow.variable} ${barlowCondensed.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <div className="mx-auto flex w-full max-w-lg flex-1 flex-col">
          {children}
        </div>
        <TabBar />
      </body>
    </html>
  );
}
