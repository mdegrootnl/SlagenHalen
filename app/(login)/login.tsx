'use client';

import Link from 'next/link';
import { useActionState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CircleIcon, Loader2 } from 'lucide-react';
import { signIn, signUp } from './actions';
import { ActionState } from '@/lib/auth/middleware';

export function Login({ mode = 'signin' }: { mode?: 'signin' | 'signup' }) {
  const searchParams = useSearchParams();
  const redirect = searchParams.get('redirect');
  const priceId = searchParams.get('priceId');
  const inviteId = searchParams.get('inviteId');
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    mode === 'signin' ? signIn : signUp,
    { error: '' }
  );

  useEffect(() => {
    if (state) {
      console.log("Login/Signup Action State:", JSON.stringify(state, null, 2));
      if (state.error) {
        console.error("Action Error:", state.error);
      }
      if (state.success) {
        console.log("Action Success:", state.success);
      }
    }
  }, [state]);

  const pageTitle = mode === 'signin' ? 'Aanmelden bij je account' : 'Account Aanmaken';
  const primaryButtonText = mode === 'signin' ? 'Aanmelden' : 'Registreren';
  const secondaryLinkText = mode === 'signin' ? 'Nog geen account? Registreer hier' : 'Al een account? Meld je hier aan';
  const secondaryLinkHref = `${mode === 'signin' ? '/sign-up' : '/sign-in'}${
    redirect ? `?redirect=${redirect}` : ''
  }${priceId ? `&priceId=${priceId}` : ''}${inviteId ? `&inviteId=${inviteId}` : ''}`;

  return (
    <div className="min-h-[100dvh] flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 bg-slate-900 text-slate-100">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <CircleIcon className="h-12 w-12 text-purple-400" />
        </div>
        <h2 className="mt-6 text-center text-3xl font-extrabold text-slate-50">
          {pageTitle}
        </h2>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-slate-800 py-8 px-4 shadow sm:rounded-lg sm:px-10">
          <form className="space-y-6" action={formAction}>
            <input type="hidden" name="redirect" value={redirect || ''} />
            <input type="hidden" name="priceId" value={priceId || ''} />
            <input type="hidden" name="inviteId" value={inviteId || ''} />
            
            {mode === 'signup' && (
              <div>
                <Label
                  htmlFor="name"
                  className="block text-sm font-medium text-slate-300"
                >
                  Naam
                </Label>
                <div className="mt-1">
                  <Input
                    id="name"
                    name="name"
                    type="text"
                    autoComplete="name"
                    defaultValue={state.name}
                    required
                    maxLength={100}
                    className="appearance-none rounded-md relative block w-full px-3 py-2 border border-slate-600 bg-slate-700 placeholder-slate-400 text-slate-100 focus:outline-none focus:ring-purple-500 focus:border-purple-500 focus:z-10 sm:text-sm"
                    placeholder="Voer je naam in"
                  />
                </div>
              </div>
            )}
            
            <div>
              <Label
                htmlFor="email"
                className="block text-sm font-medium text-slate-300"
              >
                E-mailadres
              </Label>
              <div className="mt-1">
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  defaultValue={state.email}
                  required
                  maxLength={50}
                  className="appearance-none rounded-md relative block w-full px-3 py-2 border border-slate-600 bg-slate-700 placeholder-slate-400 text-slate-100 focus:outline-none focus:ring-purple-500 focus:border-purple-500 focus:z-10 sm:text-sm"
                  placeholder="Voer je e-mailadres in"
                />
              </div>
            </div>

            <div>
              <Label
                htmlFor="password"
                className="block text-sm font-medium text-slate-300"
              >
                Wachtwoord
              </Label>
              <div className="mt-1">
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete={
                    mode === 'signin' ? 'current-password' : 'new-password'
                  }
                  defaultValue={state.password}
                  required
                  minLength={8}
                  maxLength={100}
                  className="appearance-none rounded-md relative block w-full px-3 py-2 border border-slate-600 bg-slate-700 placeholder-slate-400 text-slate-100 focus:outline-none focus:ring-purple-500 focus:border-purple-500 focus:z-10 sm:text-sm"
                  placeholder="Voer je wachtwoord in"
                />
              </div>
            </div>

            {state?.error && (
              <div className="text-red-400 text-sm p-2 bg-red-900/30 rounded-md">{state.error}</div>
            )}

            <div>
              <Button
                type="submit"
                className={`w-full flex justify-center items-center py-2.5 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white ${mode === 'signin' ? 'bg-purple-600 hover:bg-purple-700 focus:ring-purple-500' : 'bg-sky-600 hover:bg-sky-700 focus:ring-sky-500'} focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-800`}
                disabled={pending}
              >
                {pending ? (
                  <>
                    <Loader2 className="animate-spin mr-2 h-4 w-4" />
                    Bezig...
                  </>
                ) : primaryButtonText}
              </Button>
            </div>
          </form>

          <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-600" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-slate-800 text-slate-400">
                  {mode === 'signin' ? 'Of' : 'Of'}
                </span>
              </div>
            </div>

            <div className="mt-6">
              <Link
                href={secondaryLinkHref}
                className="w-full flex justify-center py-2.5 px-4 border border-slate-500 rounded-md shadow-sm text-sm font-medium text-slate-200 bg-slate-700 hover:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-800 focus:ring-purple-500"
              >
                {secondaryLinkText}
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
