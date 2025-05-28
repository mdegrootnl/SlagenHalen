import { getUser } from '@/lib/db/queries';
import Link from 'next/link';
import { UserMenu } from '@/components/site-header';
import { User } from '@/lib/db/schema';
import AuthenticatedLandingContent from '@/components/authenticated-landing-content';
import { Suspense } from 'react';
import Image from 'next/image';

export default async function LandingPage() {
  let user: User | null = null;
  try {
    user = await getUser();
  } catch (error) {
    console.warn("Error fetching user for landing page (this might be normal if not logged in):", error);
  }

  const isAuthenticated = !!user;

  return (
    <div className="flex flex-col min-h-screen relative">
      {isAuthenticated && (
        <div className="absolute top-4 right-4 z-50">
          <Suspense fallback={<div className="h-9 w-9 rounded-full bg-gray-200 animate-pulse" />}>
            <UserMenu />
          </Suspense>
        </div>
      )}
      <h1 className="text-5xl sm:text-6xl font-bold tracking-tight text-center text-white pt-10 pb-5" style={{fontFamily: 'serif'}}>
        Slagen Halen
      </h1>
      <main className="flex-grow flex flex-col items-center justify-center text-center p-5">
        {/* <h1 style={{ fontSize: '2.5rem', marginBottom: '1rem' }}>Welcome to the Game!</h1> */}
        
        {isAuthenticated && user ? (
          <AuthenticatedLandingContent user={user} />
        ) : (
          <div className="flex flex-col items-center justify-center text-white w-full">
            <div className="mb-8">
              <Image 
                src="/images/landing_page/slagenhalen.png"
                alt="Slagen Halen Game Logo"
                width={600}
                height={400}
                priority
              />
            </div>
            <p className="text-xl sm:text-2xl mb-6 text-shadow-lg">
              Meld je aan of registreer om te beginnen met spelen.
            </p>
            <div className="flex flex-col sm:flex-row justify-center gap-4 w-full max-w-xs sm:max-w-sm">
              <Link 
                href="/sign-in" 
                className="bg-purple-600 hover:bg-purple-700 text-white font-semibold py-3 px-6 rounded-lg text-lg shadow-lg transform hover:scale-105 transition-transform duration-150 ease-in-out no-underline text-center"
              >
                Aanmelden
              </Link>
              <Link 
                href="/sign-up" 
                className="bg-sky-500 hover:bg-sky-600 text-white font-semibold py-3 px-6 rounded-lg text-lg shadow-lg transform hover:scale-105 transition-transform duration-150 ease-in-out no-underline text-center"
              >
                Registreren
              </Link>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
