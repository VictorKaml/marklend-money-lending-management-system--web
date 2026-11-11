import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'MarkLend', description: 'MarkLend loan management and portfolio platform' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
