'use client';

import { useEffect, useEffectEvent, useState } from 'react';
import { Activity, X, Info } from 'lucide-react';
import { getUploadThingUsageAction } from '@/features/files/server/actions';

type UploadThingUsageState = Awaited<ReturnType<typeof getUploadThingUsageAction>>;

function formatBytes(bytes: number) {
  if (bytes <= 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export function LimitsModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [uploadThingUsage, setUploadThingUsage] = useState<UploadThingUsageState>(null);
  const [loadingUploadThing, setLoadingUploadThing] = useState(false);

  const loadUploadThingUsage = useEffectEvent(async () => {
    setLoadingUploadThing(true);
    try {
      const usage = await getUploadThingUsageAction();
      setUploadThingUsage(usage);
    } finally {
      setLoadingUploadThing(false);
    }
  });

  useEffect(() => {
    if (isOpen) {
      void loadUploadThingUsage();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/40 p-4 pb-[calc(var(--safe-bottom)+1rem)] pt-[calc(var(--safe-top)+1rem)] backdrop-blur-sm animate-in fade-in duration-200">
      <div className="mx-auto my-4 flex min-h-full w-full max-w-md items-end justify-center sm:items-center">
      <div className="w-full max-h-[calc(100dvh-var(--safe-top)-var(--safe-bottom)-1rem)] overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900 animate-in zoom-in-95 duration-200">
        
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-5 py-4">
          <div className="flex items-center gap-2 font-semibold pr-3">
            <Activity className="w-5 h-5 text-blue-500 shrink-0" />
            Usage & Limits
          </div>
          <button onClick={onClose} className="p-2 text-zinc-400 hover:text-black dark:hover:text-white rounded-full transition-colors shrink-0">
             <X className="w-5 h-5" />
          </button>
        </div>

        <div className="max-h-[calc(100dvh-8rem)] overflow-y-auto px-4 py-5 sm:px-5">
        <div className="text-sm text-zinc-500 dark:text-zinc-400 mb-6 bg-zinc-50 dark:bg-zinc-800/50 p-3 rounded-xl flex gap-2">
           <Info className="w-4 h-4 shrink-0 mt-0.5" />
           Live limit fetching from providers is not available natively via prompt parameters. These are config-based limit estimates.
        </div>

        <div className="space-y-4">
          <div className="p-4 border border-zinc-200 dark:border-zinc-800 rounded-xl space-y-3">
             <div className="flex items-center justify-between font-semibold">
               <span>UploadThing Storage</span>
               <span className={`text-xs px-2 py-1 rounded-md ${
                 uploadThingUsage?.connected
                   ? uploadThingUsage.nearLimit
                     ? 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300'
                     : 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                   : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300'
               }`}>
                 {loadingUploadThing
                   ? 'Loading'
                   : !uploadThingUsage?.configured
                     ? 'Not configured'
                     : !uploadThingUsage.enabled
                       ? 'Disabled'
                       : uploadThingUsage.connected
                         ? uploadThingUsage.nearLimit
                           ? 'Near limit'
                           : 'Connected'
                         : 'Cached'}
               </span>
             </div>
             <div className="space-y-1.5">
               <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                 <div
                   className={`h-full rounded-full transition-all ${
                     uploadThingUsage?.nearLimit ? 'bg-amber-500' : 'bg-blue-500'
                   }`}
                   style={{
                     width: `${Math.min(
                       uploadThingUsage?.limitBytes ? (uploadThingUsage.appTotalBytes / uploadThingUsage.limitBytes) * 100 : 0,
                       100
                     )}%`,
                   }}
                 />
               </div>
               <p className="text-xs text-zinc-500">
                 {uploadThingUsage
                   ? `${formatBytes(uploadThingUsage.appTotalBytes)} used of ${formatBytes(uploadThingUsage.limitBytes)}`
                   : 'Add your UploadThing token in Settings to see live quota.'}
               </p>
               <p className="text-xs text-zinc-500">
                 {uploadThingUsage
                   ? `${uploadThingUsage.filesUploaded} files uploaded in the current app bucket`
                   : 'Oldest stored files are evicted automatically once CheapChat approaches the storage cap.'}
               </p>
               {uploadThingUsage?.cachedAt && !uploadThingUsage.connected && (
                 <p className="text-xs text-zinc-500">Showing cached usage from {new Date(uploadThingUsage.cachedAt).toLocaleString()}.</p>
               )}
             </div>
          </div>
          
          <div className="p-4 border border-zinc-200 dark:border-zinc-800 rounded-xl space-y-2">
             <div className="flex items-center justify-between font-semibold">
               <span>Google AI Studio</span>
               <span className="text-xs px-2 py-1 bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 rounded-md">Operational</span>
             </div>
             <p className="text-xs text-zinc-500">Rate Limit: 15 Requests per minute (Flash)</p>
             <p className="text-xs text-zinc-500">Rate Limit: 2 Requests per minute (Pro)</p>
          </div>

          <div className="p-4 border border-zinc-200 dark:border-zinc-800 rounded-xl space-y-2">
             <div className="flex items-center justify-between font-semibold">
               <span>Groq (LPUs)</span>
               <span className="text-xs px-2 py-1 bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 rounded-md">Operational</span>
             </div>
             <p className="text-xs text-zinc-500">Rate Limit: 30 Requests per minute</p>
             <p className="text-xs text-zinc-500">Tokens: ~14k Tokens per minute</p>
          </div>

          <div className="p-4 border border-zinc-200 dark:border-zinc-800 rounded-xl space-y-2">
             <div className="flex items-center justify-between font-semibold">
               <span>OpenRouter (Free)</span>
               <span className="text-xs px-2 py-1 bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 rounded-md">Operational</span>
             </div>
             <p className="text-xs text-zinc-500">Rate Limit: Depends on specific free model load (10-20 Req / min approx)</p>
          </div>

          <div className="p-4 border border-zinc-200 dark:border-zinc-800 rounded-xl space-y-2">
             <div className="flex items-center justify-between font-semibold">
               <span>Cerebras</span>
               <span className="text-xs px-2 py-1 bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 rounded-md">Operational</span>
             </div>
             <p className="text-xs text-zinc-500">Rate Limit: Model-dependent account quota</p>
             <p className="text-xs text-zinc-500">Typical CheapChat route: Llama 3.1 8B / Llama 3.3 70B</p>
          </div>

          <div className="p-4 border border-zinc-200 dark:border-zinc-800 rounded-xl space-y-2">
             <div className="flex items-center justify-between font-semibold">
               <span>Mistral</span>
               <span className="text-xs px-2 py-1 bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 rounded-md">Operational</span>
             </div>
             <p className="text-xs text-zinc-500">Rate Limit: Model-dependent account quota</p>
             <p className="text-xs text-zinc-500">Typical CheapChat route: Mistral Small / Mistral Large</p>
          </div>

        </div>
        </div>

      </div>
      </div>
    </div>
  );
}
