// 'use client'; // This layout itself doesn't need to be a client component if Header is one

// import Link from 'next/link';
// import { useState, Suspense } from 'react';
// import { Button } from '@/components/ui/button';
// import { CircleIcon, Home, LogOut } from 'lucide-react';
// import {
//   DropdownMenu,
//   DropdownMenuContent,
//   DropdownMenuItem,
//   DropdownMenuTrigger
// } from '@/components/ui/dropdown-menu';
// import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
// import { signOut } from '@/app/(login)/actions';
// import { useRouter } from 'next/navigation';
// import { User } from '@/lib/db/schema';
// import useSWR from 'swr';

import SiteHeader from '@/components/site-header'; // Import the new SiteHeader

// const fetcher = (url: string) => fetch(url).then((res) => res.json());

// function UserMenu() { ... } // Removed UserMenu, it's in SiteHeader
// function Header() { ... } // Removed Header, it's in SiteHeader

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <section className="flex flex-col min-h-screen">
      <SiteHeader /> {/* Use the imported SiteHeader */}
      {children}
    </section>
  );
}
