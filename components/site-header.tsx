'use client';

import Link from 'next/link';
import { useState, Suspense } from 'react'; // Removed 'use' as it's not standard
import { Button } from '@/components/ui/button';
import { CircleIcon, Home, LogOut } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { signOut } from '@/app/(login)/actions'; // Path to signOut server action
import { useRouter } from 'next/navigation';
import { User } from '@/lib/db/schema'; // Path to User type
import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

// UserMenu component
export function UserMenu() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  // Ensure the API route /api/user exists and returns User data or null
  const { data: user, error } = useSWR<User | null>('/api/user', fetcher); 
  const router = useRouter();

  async function handleSignOut() {
    await signOut();
    router.refresh(); // Refreshes the current route and refetches data
    router.push('/'); // Redirect to home page after sign out
  }

  // Optional: Loading state based on SWR
  if (user === undefined && !error) {
    return <div className="h-9 w-24 rounded-full bg-gray-200 animate-pulse" />; // Placeholder for loading
  }

  if (!user) {
    // This part is from the original dashboard layout.
    // For a global site header, you might want different behavior
    // or to make these links configurable.
    // For now, keeping it as is.
    return (
      <>
        <Link
          href="/pricing" // Example link, adjust as per your app's routes
          className="text-sm font-medium text-gray-700 hover:text-gray-900"
        >
          Pricing
        </Link>
        <Button asChild className="rounded-full">
          <Link href="/sign-up">Sign Up</Link>
        </Button>
      </>
    );
  }

  // Logged-in user menu
  return (
    <DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
      <DropdownMenuTrigger>
        <Avatar className="cursor-pointer size-9">
          {/* user.name is nullable, provide a fallback string for alt if it is null */}
          <AvatarImage src={undefined} alt={user.name || 'User Avatar'} /> 
          <AvatarFallback>
            {user.email // Ensure email is available and not null
              ?.split(' ')
              .map((n) => n[0])
              .join('')
              .toUpperCase()}
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56"> {/* Added min-width for consistency */}
        <DropdownMenuItem className="cursor-pointer" asChild>
          <Link href="/dashboard" className="flex w-full items-center">
            <Home className="mr-2 h-4 w-4" />
            <span>Dashboard</span>
          </Link>
        </DropdownMenuItem>
        {/* Optional: Add other links like Profile/Settings here */}
        {/* <DropdownMenuSeparator /> */}
        <DropdownMenuItem asChild>
          {/* Using a form for sign out to ensure POST request if server action requires it */}
          <form action={handleSignOut} className="w-full">
            <button type="submit" className="flex w-full items-center cursor-pointer text-sm p-2 hover:bg-accent rounded-sm">
              <LogOut className="mr-2 h-4 w-4" />
              <span>Sign out</span>
            </button>
          </form>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Header component
export default function SiteHeader() { // Exporting SiteHeader as default
  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 max-w-screen-2xl items-center mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mr-4 hidden md:flex">
          <Link href="/" className="mr-6 flex items-center space-x-2">
            <CircleIcon className="h-6 w-6 text-orange-500" />
            <span className="hidden font-bold sm:inline-block text-gray-900">
            Resultatus Obtinendo {/* Placeholder name, update as needed */}
            </span>
          </Link>
          <nav className="flex items-center gap-6 text-sm">
            {/* Example nav links, customize as needed */}
            {/* <Link
              href="/features"
              className="transition-colors hover:text-foreground/80 text-foreground/60"
            >
              Features
            </Link>
            <Link
              href="/pricing"
              className="transition-colors hover:text-foreground/80 text-foreground/60"
            >
              Pricing
            </Link> */}
          </nav>
        </div>
        <div className="flex flex-1 items-center justify-between space-x-2 md:justify-end">
          <Suspense fallback={<div className="h-9 w-24 rounded-full bg-gray-200 animate-pulse" />}>
            <UserMenu />
          </Suspense>
        </div>
      </div>
    </header>
  );
} 