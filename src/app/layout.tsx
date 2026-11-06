import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const sans = Geist({ variable: "--font-app", subsets: ["latin"] });
const mono = Geist_Mono({ variable: "--font-app-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Inbounderz WorkHub", template: "%s · Inbounderz WorkHub" },
  description: "Inbounderz internal platform for employees, departments, projects and tasks.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#16a34a" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full bg-background font-sans text-foreground">
        <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
        <Toaster position="top-right" richColors closeButton />
      </body>
    </html>
  );
}
