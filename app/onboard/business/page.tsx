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
        <p className="text-xs font-mono tracking-widest text-ink-3 mb-3 uppercase">Step 2 of 5</p>
        <h1 className="font-serif text-4xl md:text-5xl leading-[1.1] tracking-tight mb-3">
          What do you offer?
        </h1>
        <p className="text-ink-2 mb-10 max-w-lg">
          Your business name, your brand persona, and where buyers can learn more. Your Sales Agent
          reads the persona to decide which buyer briefs to answer and what to offer, so it is the
          most important thing you write here.
        </p>

        <form onSubmit={onSubmit} className="space-y-5 max-w-xl">
          <label className="block">
            <span className="text-xs font-mono tracking-widest text-ink-3 uppercase block mb-2">Business name</span>
            <input
              type="text" required value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-paper border border-line-strong px-4 py-3 text-base outline-none focus:border-ink transition-colors"
            />
          </label>

          <label className="block">
            <span className="text-xs font-mono tracking-widest text-ink-3 uppercase block mb-2">URL slug</span>
            <div className="flex items-center gap-2">
              <span className="text-sm text-ink-3 font-mono">app.getvia.xyz/seller/</span>
              <input
                type="text" required value={effectiveSlug}
                onChange={(e) => { setSlug(slugifyName(e.target.value)); setTouchedSlug(true); }}
                className="flex-1 bg-paper border border-line-strong px-4 py-3 text-base font-mono outline-none focus:border-ink transition-colors"
              />
            </div>
            <span className="text-xs text-ink-3 mt-2 block">Lowercase letters, numbers, hyphens. Auto-derived from your name; edit if you want.</span>
          </label>

          <fieldset>
            <legend className="text-xs font-mono tracking-widest text-ink-3 uppercase block mb-2">What kind of seller?</legend>
            <div className="grid grid-cols-3 gap-2">
              {(['product', 'service', 'mixed'] as const).map((k) => (
                <button
                  type="button"
                  key={k}
                  onClick={() => setKind(k)}
                  className={`px-4 py-3 text-sm border transition-colors ${
                    kind === k
                      ? 'bg-ink text-background border-ink'
                      : 'bg-paper text-ink-2 border-line-strong hover:border-ink'
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
            <span className="text-xs font-mono tracking-widest text-ink-3 uppercase block mb-2">Brand persona</span>
            <textarea
              value={description} rows={4}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Who you are, what you make, who it is for, and your vibe. Example: A British lifestyle brand built around the annual 3,000-mile international motor rally. Apparel, headwear, and accessories for fans of cars, motorsport, and the racing lifestyle."
              className="w-full bg-paper border border-line-strong px-4 py-3 text-base outline-none focus:border-ink transition-colors resize-y"
            />
            <span className="text-xs text-ink-3 mt-2 block">
              This is your agent&rsquo;s brief. It reads this to judge buyer requests as your brand and
              pick what to offer. A vague line (&ldquo;home baked bread and more&rdquo;) makes it miss
              matches; name your identity, what you make, who it is for, and your vibe.
            </span>
          </label>

          <label className="block">
            <span className="text-xs font-mono tracking-widest text-ink-3 uppercase block mb-2">Website (optional)</span>
            <input
              type="url" value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              placeholder="https://"
              className="w-full bg-paper border border-line-strong px-4 py-3 text-base outline-none focus:border-ink transition-colors"
            />
          </label>

          {err && <p className="text-sm text-[color:var(--danger)]">{err}</p>}

          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              onClick={() => router.push('/onboard/account?role=seller')}
              className="text-xs font-mono tracking-widest uppercase text-ink-3 hover:text-ink transition-colors"
            >
              <span aria-hidden>←</span> Back
            </button>
            <button type="submit" className="btn">
              Continue <span className="arrow" aria-hidden>→</span>
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}
