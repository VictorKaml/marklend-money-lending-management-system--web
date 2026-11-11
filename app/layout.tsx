import type { Metadata } from 'next';
import { Analytics } from "@vercel/analytics/next"
import { SpeedInsights } from '@vercel/speed-insights/next';
export const metadata: Metadata = { title: 'MarkLend', description: 'MarkLend loan management and portfolio platform' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><Analytics/><body>{children}<SpeedInsights /></body></html>; }
