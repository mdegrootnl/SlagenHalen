import './globals.css';
import type { Metadata, Viewport } from 'next';
import { Manrope } from 'next/font/google';
import { getUser, getTeamForUser } from '@/lib/db/queries';
import { SWRConfig } from 'swr';
import { Toaster as SonnerToaster } from "@/components/ui/sonner"; // New Sonner Toaster
import { SocketProvider } from '@/contexts/SocketContext'; // Added SocketProvider import

export const metadata: Metadata = {
  title: 'Slagen Halen Kaartspel',
  description: 'Een online multiplayer kaartspel waar je slagen moet halen.'
};

export const viewport: Viewport = {
  maximumScale: 1
};

const manrope = Manrope({ subsets: ['latin'] });

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="nl"
      className={`bg-white dark:bg-gray-950 text-black dark:text-white ${manrope.className}`}
    >
      <body className="min-h-[100dvh] bg-slate-900">
        <SWRConfig
          value={{
            fallback: {
              // We do NOT await here
              // Only components that read this data will suspend
              '/api/user': getUser(),
              '/api/team': getTeamForUser()
            }
          }}
        >
          <SocketProvider> {/* Added SocketProvider wrapper */}
            {children}
          </SocketProvider>
        </SWRConfig>
        <SonnerToaster /> {/* Added Sonner Toaster component here */}
      </body>
    </html>
  );
}
