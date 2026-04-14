'use client';

import { useActionState } from 'react';
import { loginAction } from '@/actions/auth';
import { KeyRound, ArrowRight, Loader2 } from 'lucide-react';

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(loginAction, null);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-zinc-50 p-4 pb-[calc(var(--safe-bottom)+1rem)] pt-[calc(var(--safe-top)+1rem)] dark:bg-black">
      <div className="w-full max-w-sm flex flex-col items-center gap-8">
        
        {/* Logo or Icon */}
        <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-black dark:bg-white text-white dark:text-black shadow-lg shadow-black/5">
          <KeyRound size={32} />
        </div>

        {/* Text */}
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            Welcome to CheapChat
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Enter the shared password to jump in.
          </p>
        </div>

        {/* Form */}
        <form action={formAction} className="w-full space-y-4">
          <div className="space-y-2">
            <input
              type="password"
              name="password"
              placeholder="Password"
              required
              autoFocus
              className="w-full h-12 px-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-black dark:focus:ring-white transition-all shadow-sm"
            />
            {state?.error && (
              <p className="text-sm text-red-500 font-medium px-2">{state.error}</p>
            )}
          </div>
          
          <button
            type="submit"
            disabled={pending}
            className="group relative flex w-full h-12 items-center justify-center gap-2 rounded-xl bg-black dark:bg-white text-white dark:text-black font-medium transition-all hover:bg-zinc-800 dark:hover:bg-zinc-200 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
          >
            {pending ? (
              <Loader2 className="animate-spin w-5 h-5 text-white dark:text-black" />
            ) : (
              <>
                Unlock
                <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
              </>
            )}
          </button>
        </form>

      </div>
    </div>
  );
}
