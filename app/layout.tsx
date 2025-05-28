import './globals.css';
import type { Metadata, Viewport } from 'next';
// Intentionally leaving the Manrope import commented or removed
import { getUser, getTeamForUser } from '@/lib/db/queries';
import { SWRConfig } from 'swr';
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { SocketProvider } from '@/contexts/SocketContext';

export const metadata: Metadata = {
  title: 'Slagen Halen Kaartspel',
  description: 'Een online multiplayer kaartspel waar je slagen moet halen.'
};

export const viewport: Viewport = {
  maximumScale: 1
};

// Ensure no 'Manrope' or 'manrope' instantiation here

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="nl"
      className={`bg-white dark:bg-gray-950 text-black dark:text-white`}
    >
      <body className="min-h-[100dvh] bg-slate-900 font-sans">
        <SWRConfig
          value={{
            fallback: {
              '/api/user': getUser(),
              '/api/team': getTeamForUser()
            }
          }}
        >
          <SocketProvider>
            {children}
          </SocketProvider>
        </SWRConfig>
        <SonnerToaster />
      </body>
    </html>
  );
}
