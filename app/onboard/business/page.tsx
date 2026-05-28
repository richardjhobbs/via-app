'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { OnboardSteps } from '../OnboardSteps';
import { readOnboardState, writeOnboardState, slugifyName } from '@/lib/app/onboarding-state';

export default function OnboardBusiness() {
  const router = useRouter();
  const [name,        setName]        = useState('');
  const [slug,        setSlug]        = useState('');
  const [kind,        setKind]        = useState<'product' | 'service' | 'mixed'>('product');
  const [description, setDescription] = useState('');
  const [websiteUrl,  setWebsiteUrl]  = useState('');
  const [touchedSlug, setTouchedSlug] = useState(false);
  const [err,         setErr]         = useState('');

  // Gate: require account step to be done.
  useEffect(() => {
    const s = readOnboardState();
    if (!s?.email || s.role !== 'seller') { router.replace('/onboard?role=seller'); return; }
    if (s.sellerName)    setName(s.sellerName);
    if (s.slug)        { setSlug(s.slug); setTouchedSlug(true); }
    if (s.kind)          setKind(s.kind);
    if (s.description)   setDescription(s.description);
    if (s.websiteUrl)    setWebsiteUrl(s.websiteUrl);
  }, [router]);

  // Slug is computed on render, not via useEffect, so there is no race
  // between the localStorage-restore effect and the auto-derive effect.
  // If the user has not edited the slug directly (touchedSlug=false),
  // it tracks slugifyName(name) live as they type the business name.
  const effectiveSlug = touchedSlug ? slug : slugifyName(name);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    if (!name.trim())           { setErr('Business name is required.'); return; }
    if (!effectiveSlug)         { setErr('Slug must contain at least one alphanumeric character.'); return; }
    if (websiteUrl && !/^https?:\/\//.test(websiteUrl)) { setErr('Website URL must start with http(s)://'); return; }

    writeOnboardState({
      role: 'seller',
      sellerName: name.trim(),
      slug:        effectiveSlug,
      kind,
      description: description.trim() || undefined,
      websiteUrl:  websiteUrl.trim()  || undefined,
    });
    router.push('/onboard/wallet');
  }

  return (
    <section className="flex-1 px-6 py-16">
      <div className="max-w-2xl mx-auto">
        <OnboardSteps current={2} />
        <p className="text-xs font-mono tracking-widest text-neutral-500 mb-3 uppercase">Step 2 of 5</p>
        <h1 className="font-serif text-4xl md:text-5xl leading-[1.1] tracking-tight mb-3">
          What do you offer?
        </h1>
        <p className="text-neutral-600 mb-10 max-w-lg">
          Your business name, what you sell, and where buyers can learn more. Buying agents will
          read this when they discover you.
        </p>

        <form onSubmit={onSubmit} className="space-y-5 max-w-xl">
          <label className="block">
            <span className="text-xs font-mono tracking-widest text-neutral-500 uppercase block mb-2">Business name</span>
            <input
              type="text" required value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-white border border-neutral-300 px-4 py-3 text-base outline-none focus:border-neutral-900 transition-colors rounded-md"
            />
          </label>

          <label className="block">
            <span className="text-xs font-mono tracking-widest text-neutral-500 uppercase block mb-2">URL slug</span>
            <div className="flex items-center gap-2">
              <span className="text-sm text-neutral-500 font-mono">app.getvia.xyz/seller/</span>
              <input
                type="text" required value={effectiveSlug}
                onChange={(e) => { setSlug(slugifyName(e.target.value)); setTouchedSlug(true); }}
                className="flex-1 bg-white border border-neutral-300 px-4 py-3 text-base font-mono outline-none focus:border-neutral-900 transition-colors rounded-md"
              />
            </div>
            <span className="text-xs text-neutral-500 mt-2 block">Lowercase letters, numbers, hyphens. Auto-derived from your name; edit if you want.</span>
          </label>

          <fieldset>
            <legend className="text-xs font-mono tracking-widest text-neutral-500 uppercase block mb-2">What kind of seller?</legend>
            <div className="grid grid-cols-3 gap-2">
              {(['product', 'service', 'mixed'] as const).map((k) => (
                <button
                  type="button"
                  key={k}
                  onClick={() => setKind(k)}
                  className={`px-4 py-3 text-sm border rounded-md transition-colors ${
                    kind === k
                      ? 'bg-neutral-900 text-neutral-50 border-neutral-900'
                      : 'bg-white text-neutral-700 border-neutral-300 hover:border-neutral-900'
                  }`}
                >
                  {k === 'product' && 'Physical or digital goods'}
                  {k === 'service' && 'Services'}
                  {k === 'mixed'   && 'A mix of both'}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="block">
            <span className="text-xs font-mono tracking-widest text-neutral-500 uppercase block mb-2">One-line description</span>
            <input
              type="text" value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What you sell or offer, in one line."
              className="w-full bg-white border border-neutral-300 px-4 py-3 text-base outline-none focus:border-neutral-900 transition-colors rounded-md"
            />
          </label>

          <label className="block">
            <span className="text-xs font-mono tracking-widest text-neutral-500 uppercase block mb-2">Website (optional)</span>
            <input
              type="url" value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              placeholder="https://"
              className="w-full bg-white border border-neutral-300 px-4 py-3 text-base outline-none focus:border-neutral-900 transition-colors rounded-md"
            />
          </label>

          {err && <p className="text-sm text-red-600">{err}</p>}

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => router.push('/onboard/account?role=seller')}
              className="text-xs font-mono tracking-widest uppercase text-neutral-500 hover:text-neutral-900 transition-colors"
            >
              <span aria-hidden>←</span> Back
            </button>
            <button
              type="submit"
              className="px-6 py-3 bg-neutral-900 text-neutral-50 text-xs font-mono tracking-widest uppercase hover:bg-neutral-800 transition-colors rounded-md"
            >
              Continue <span aria-hidden>→</span>
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
