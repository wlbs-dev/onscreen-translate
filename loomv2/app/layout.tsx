import "./globals.css"
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata = { title: "Video Translation Editor" }
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en" className={cn("font-sans", geist.variable)}><body>{children}</body></html>
}