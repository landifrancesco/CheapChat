'use client';

import { useEffect, useEffectEvent, useState } from 'react';
import { Loader2, Settings2, X } from 'lucide-react';

export function SettingsModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [googleKey, setGoogleKey] = useState('');
  const [googleEnabled, setGoogleEnabled] = useState(true);

  const [groqKey, setGroqKey] = useState('');
  const [groqEnabled, setGroqEnabled] = useState(true);

  const [cerebrasKey, setCerebrasKey] = useState('');
  const [cerebrasEnabled, setCerebrasEnabled] = useState(true);

  const [mistralKey, setMistralKey] = useState('');
  const [mistralEnabled, setMistralEnabled] = useState(true);

  const [openRouterKey, setOpenRouterKey] = useState('');
  const [openRouterEnabled, setOpenRouterEnabled] = useState(true);
  const [uploadThingKey, setUploadThingKey] = useState('');
  const [uploadThingEnabled, setUploadThingEnabled] = useState(true);

  const [activeTab, setActiveTab] = useState<'Core' | 'Providers' | 'Storage'>('Core');
  const [isLoadingSettings, setIsLoadingSettings] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  function getInputType(value: string) {
    return value.startsWith('***') ? 'password' : 'text';
  }

  function handleClose() {
    setSuccessMsg('');
    setErrorMsg('');
    onClose();
  }

  const loadSettings = useEffectEvent(async () => {
    setIsLoadingSettings(true);
    setErrorMsg('');

    try {
      const response = await fetch('/api/settings/providers', {
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
      });

      if (!response.ok) {
        throw new Error(`Failed to load settings (${response.status})`);
      }

      const data = (await response.json()) as {
        providers?: Record<string, { apiKey: string; enabled: boolean }>;
      };
      const providers = data.providers ?? {};

      setGoogleKey(providers.google?.apiKey ?? '');
      setGoogleEnabled(providers.google?.enabled ?? true);
      setGroqKey(providers.groq?.apiKey ?? '');
      setGroqEnabled(providers.groq?.enabled ?? true);
      setCerebrasKey(providers.cerebras?.apiKey ?? '');
      setCerebrasEnabled(providers.cerebras?.enabled ?? true);
      setMistralKey(providers.mistral?.apiKey ?? '');
      setMistralEnabled(providers.mistral?.enabled ?? true);
      setOpenRouterKey(providers.openrouter?.apiKey ?? '');
      setOpenRouterEnabled(providers.openrouter?.enabled ?? true);
      setUploadThingKey(providers.uploadthing?.apiKey ?? '');
      setUploadThingEnabled(providers.uploadthing?.enabled ?? true);
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'Failed to load settings.');
    } finally {
      setIsLoadingSettings(false);
    }
  });

  useEffect(() => {
    if (isOpen) {
      void loadSettings();
    }
  }, [isOpen]);

  async function handleSave() {
    setIsSaving(true);
    setSuccessMsg('');
    setErrorMsg('');

    try {
      const configs = [
        { id: 'google', key: googleKey, enabled: googleEnabled },
        { id: 'groq', key: groqKey, enabled: groqEnabled },
        { id: 'cerebras', key: cerebrasKey, enabled: cerebrasEnabled },
        { id: 'mistral', key: mistralKey, enabled: mistralEnabled },
        { id: 'openrouter', key: openRouterKey, enabled: openRouterEnabled },
        { id: 'uploadthing', key: uploadThingKey, enabled: uploadThingEnabled },
      ];

      const response = await fetch('/api/settings/providers', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          configs: configs.map((config) => ({
            id: config.id,
            apiKey: config.key,
            enabled: config.enabled,
          })),
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error || `Failed to save settings (${response.status})`);
      }

      setSuccessMsg('Settings saved successfully!');
      setTimeout(() => handleClose(), 1500);
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : 'Failed to save settings.');
    } finally {
      setIsSaving(false);
    }
  }

  if (!isOpen) return null;

  const connectedDot = (
    <div className="h-2 w-2 animate-pulse rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 pb-[calc(var(--safe-bottom)+1rem)] pt-[calc(var(--safe-top)+1rem)] backdrop-blur-md animate-in fade-in duration-300 sm:items-center">
      <div className="flex max-h-[calc(100dvh-var(--safe-top)-var(--safe-bottom)-1rem)] w-full max-w-lg flex-col overflow-hidden rounded-[1.75rem] border border-zinc-200/50 bg-white shadow-2xl animate-in zoom-in-95 duration-300 dark:border-zinc-800/50 dark:bg-zinc-950 sm:rounded-[2.5rem]">
        <div className="flex items-center justify-between gap-4 px-5 py-5 sm:px-8 sm:py-6">
          <div className="flex flex-col">
            <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
              <Settings2 className="h-5 w-5" />
              Settings
            </h2>
            <p className="text-xs font-medium text-zinc-500">Fine-tune your chat infrastructure</p>
          </div>
          <button
            onClick={handleClose}
            className="-mr-2 rounded-full p-2 text-zinc-400 transition-all hover:bg-zinc-100 hover:text-zinc-600 active:scale-95 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="mb-2 flex items-center gap-4 overflow-x-auto border-b border-zinc-100 px-5 dark:border-zinc-900/50 sm:gap-6 sm:px-8">
          {(['Core', 'Providers', 'Storage'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`relative shrink-0 pb-4 text-sm font-semibold transition-all ${
                activeTab === tab ? 'text-black dark:text-white' : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'
              }`}
            >
              {tab}
              {activeTab === tab && <div className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-black dark:bg-white" />}
            </button>
          ))}
        </div>

        <div className="custom-scrollbar flex-1 space-y-6 overflow-y-auto p-5 sm:space-y-8 sm:p-8">
          {isLoadingSettings ? (
            <div className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading saved provider settings...
            </div>
          ) : null}
          {activeTab === 'Core' && (
            <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <h3 className="text-sm font-bold tracking-tight">Google AI Studio</h3>
                    {googleKey.startsWith('***') && connectedDot}
                  </div>
                  <label className="flex cursor-pointer items-center scale-90">
                    <input type="checkbox" className="peer sr-only" checked={googleEnabled} onChange={(e) => setGoogleEnabled(e.target.checked)} />
                    <div className="relative h-6 w-11 rounded-full bg-zinc-200 peer-focus:outline-none peer-checked:bg-blue-600 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-zinc-300 after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white dark:bg-zinc-800 dark:border-zinc-600" />
                  </label>
                </div>
                <input
                  type={getInputType(googleKey)}
                  value={googleKey}
                  onChange={(e) => setGoogleKey(e.target.value)}
                  placeholder="AIzaSy..."
                  className="w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-5 py-3 font-mono text-sm shadow-sm transition-all placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-800 dark:bg-zinc-900"
                />
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <h3 className="text-sm font-bold tracking-tight">Groq</h3>
                    {groqKey.startsWith('***') && connectedDot}
                  </div>
                  <label className="flex cursor-pointer items-center scale-90">
                    <input type="checkbox" className="peer sr-only" checked={groqEnabled} onChange={(e) => setGroqEnabled(e.target.checked)} />
                    <div className="relative h-6 w-11 rounded-full bg-zinc-200 peer-focus:outline-none peer-checked:bg-blue-600 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-zinc-300 after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white dark:bg-zinc-800 dark:border-zinc-600" />
                  </label>
                </div>
                <input
                  type={getInputType(groqKey)}
                  value={groqKey}
                  onChange={(e) => setGroqKey(e.target.value)}
                  placeholder="gsk_..."
                  className="w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-5 py-3 font-mono text-sm shadow-sm transition-all placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-800 dark:bg-zinc-900"
                />
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <h3 className="text-sm font-bold tracking-tight">OpenRouter</h3>
                    {openRouterKey.startsWith('***') && connectedDot}
                  </div>
                  <label className="flex cursor-pointer items-center scale-90">
                    <input
                      type="checkbox"
                      className="peer sr-only"
                      checked={openRouterEnabled}
                      onChange={(e) => setOpenRouterEnabled(e.target.checked)}
                    />
                    <div className="relative h-6 w-11 rounded-full bg-zinc-200 peer-focus:outline-none peer-checked:bg-blue-600 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-zinc-300 after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white dark:bg-zinc-800 dark:border-zinc-600" />
                  </label>
                </div>
                <input
                  type={getInputType(openRouterKey)}
                  value={openRouterKey}
                  onChange={(e) => setOpenRouterKey(e.target.value)}
                  placeholder="sk-or-v1-..."
                  className="w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-5 py-3 font-mono text-sm shadow-sm transition-all placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-800 dark:bg-zinc-900"
                />
              </div>
            </div>
          )}

          {activeTab === 'Providers' && (
            <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <h3 className="text-sm font-bold tracking-tight text-zinc-600">Cerebras</h3>
                    {cerebrasKey.startsWith('***') && connectedDot}
                  </div>
                  <label className="flex cursor-pointer items-center scale-90 opacity-80">
                    <input
                      type="checkbox"
                      className="peer sr-only"
                      checked={cerebrasEnabled}
                      onChange={(e) => setCerebrasEnabled(e.target.checked)}
                    />
                    <div className="relative h-6 w-11 rounded-full bg-zinc-200 peer-focus:outline-none peer-checked:bg-blue-600 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-zinc-300 after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white dark:bg-zinc-800 dark:border-zinc-600" />
                  </label>
                </div>
                <input
                  type={getInputType(cerebrasKey)}
                  value={cerebrasKey}
                  onChange={(e) => setCerebrasKey(e.target.value)}
                  placeholder="csk_..."
                  className="w-full rounded-2xl border border-zinc-200/60 bg-zinc-50 px-5 py-3 font-mono text-xs shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 hover:border-blue-500 dark:border-zinc-800 dark:bg-zinc-900"
                />
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <h3 className="text-sm font-bold tracking-tight text-zinc-600">Mistral</h3>
                    {mistralKey.startsWith('***') && connectedDot}
                  </div>
                  <label className="flex cursor-pointer items-center scale-90 opacity-80">
                    <input type="checkbox" className="peer sr-only" checked={mistralEnabled} onChange={(e) => setMistralEnabled(e.target.checked)} />
                    <div className="relative h-6 w-11 rounded-full bg-zinc-200 peer-focus:outline-none peer-checked:bg-blue-600 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-zinc-300 after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white dark:bg-zinc-800 dark:border-zinc-600" />
                  </label>
                </div>
                <input
                  type={getInputType(mistralKey)}
                  value={mistralKey}
                  onChange={(e) => setMistralKey(e.target.value)}
                  placeholder="Mistral API key"
                  className="w-full rounded-2xl border border-zinc-200/60 bg-zinc-50 px-5 py-3 font-mono text-xs shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 hover:border-blue-500 dark:border-zinc-800 dark:bg-zinc-900"
                />
              </div>
            </div>
          )}

          {activeTab === 'Storage' && (
            <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <h3 className="text-sm font-bold tracking-tight">UploadThing</h3>
                    {uploadThingKey.startsWith('***') && connectedDot}
                  </div>
                  <label className="flex cursor-pointer items-center scale-90">
                    <input
                      type="checkbox"
                      className="peer sr-only"
                      checked={uploadThingEnabled}
                      onChange={(e) => setUploadThingEnabled(e.target.checked)}
                    />
                    <div className="relative h-6 w-11 rounded-full bg-zinc-200 peer-focus:outline-none peer-checked:bg-blue-600 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-zinc-300 after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white dark:bg-zinc-800 dark:border-zinc-600" />
                  </label>
                </div>
                <input
                  type={getInputType(uploadThingKey)}
                  value={uploadThingKey}
                  onChange={(e) => setUploadThingKey(e.target.value)}
                  placeholder="UPLOADTHING_TOKEN..."
                  className="w-full rounded-2xl border border-zinc-200 bg-zinc-50 px-5 py-3 font-mono text-sm shadow-sm transition-all placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-zinc-800 dark:bg-zinc-900"
                />
                <p className="text-xs leading-relaxed text-zinc-500">
                  Paste the raw UploadThing v7 token from the dashboard. CheapChat will strip `UPLOADTHING_TOKEN=` automatically if you paste the full env line, but the old secret key alone will not work.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 border-t border-zinc-100 bg-zinc-50/50 px-5 py-5 dark:border-zinc-900/50 dark:bg-zinc-900/30 sm:flex-row sm:items-center sm:justify-between sm:px-8 sm:py-6">
          <div className="text-sm font-bold text-blue-600 dark:text-blue-500 sm:flex-1">
            {errorMsg ? <span className="text-red-500 dark:text-red-400">{errorMsg}</span> : successMsg}
          </div>
          <div className="flex w-full items-center gap-3 sm:w-auto sm:justify-end sm:gap-4">
            <button onClick={handleClose} className="flex-1 px-4 py-3 text-sm font-bold text-zinc-500 transition-all hover:text-zinc-800 dark:hover:text-zinc-200 sm:flex-none sm:px-6">
              Discard
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving || isLoadingSettings}
              className="flex-1 rounded-2xl bg-black px-6 py-3 text-sm font-bold text-white shadow-lg shadow-black/10 transition-all active:scale-95 hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-zinc-200 dark:shadow-white/5 sm:flex-none sm:px-8"
            >
              {isSaving ? 'Saving...' : 'Apply Details'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
