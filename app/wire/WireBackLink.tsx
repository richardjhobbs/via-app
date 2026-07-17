'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

const LINK_CLASS = 'text-xs font-mono tracking-widest uppercase text-ink-3 hover:text-ink';
const RRG_URL = 'https://realrealgenuine.com';

/**
 * Back link that knows where the visitor came from. RRG lives on a different
 * origin, so it cannot share VIA's theme or history; the only reliable signals
 * that a visitor arrived from RRG are an explicit `?from=rrg` on the link and
 * the document referrer. We honour either, and remember the answer for the tab
 * session so a reload that drops the referrer still returns them to RRG.
 *
 * `initialFrom` is the server-read `?from` param, so the first paint is already
 * correct for the tagged nav link; the effect then adds referrer detection for
 * every other way in from RRG.
 */
export default function WireBackLink({ initialFrom }: { initialFrom?: string }) {
  const [rrg, setRrg] = useState(initialFrom === 'rrg');

  useEffect(() => {
    try {
      const param = new URLSearchParams(window.location.search).get('from');
      const ref = document.referrer || '';
      const fromRrgRef = /(^|\.)realrealgenuine\.com/i.test(new URL(ref || RRG_URL).hostname) && ref !== '';

      let decided: boolean;
      if (param === 'rrg') decided = true;
      else if (param === 'via') decided = false;
      else if (fromRrgRef) decided = true;           // arrived from RRG by any link
      else if (ref) decided = false;                 // arrived from somewhere else (e.g. VIA)
      else decided = sessionStorage.getItem('wire-from') === 'rrg'; // direct load / reload: stay sticky

      sessionStorage.setItem('wire-from', decided ? 'rrg' : 'via');
      setRrg(decided);
    } catch {
      /* keep the server-rendered default */
    }
  }, []);

  return rrg ? (
    <a href={RRG_URL} className={LINK_CLASS}>
      <span aria-hidden>←</span> Back to RRG
    </a>
  ) : (
    <Link href="/" className={LINK_CLASS}>
      <span aria-hidden>←</span> Back to VIA
    </Link>
  );
}
