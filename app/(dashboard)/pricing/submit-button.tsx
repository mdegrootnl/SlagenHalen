'use client';

import { Button } from '@/components/ui/button';
import { ArrowRight, Loader2 } from 'lucide-react';
import { useState, useTransition } from 'react';

export function SubmitButton() {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="submit"
      disabled={isPending}
      variant="outline"
      className="w-full rounded-full"
    >
      {isPending ? (
        <>
          <Loader2 className="animate-spin mr-2 h-4 w-4" />
          Loading...
        </>
      ) : (
        <>
          Get Started
          <ArrowRight className="ml-2 h-4 w-4" />
        </>
      )}
    </Button>
  );
}
