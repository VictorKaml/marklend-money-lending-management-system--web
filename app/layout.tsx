import type { Metadata } from 'next';
import { Analytics } from "@vercel/analytics/next"
export const metadata: Metadata = { title: 'MarkLend', description: 'MarkLend loan management and portfolio platform' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}<Analytics /></body></html>; }
