import Image from 'next/image';

const RATIO = 920 / 381;

/**
 * The official VIA logotype. Renders both the ink (light theme) and cream
 * (dark theme) marks; the visible one is chosen by pure CSS off [data-theme]
 * (see .via-logo-ink / .via-logo-cream in globals.css), so this stays a
 * server component and works inside any page or chrome.
 */
export function Wordmark({ height = 18 }: { height?: number }) {
  const width = Math.round(height * RATIO);
  return (
    <span className="via-wordmark" style={{ display: 'inline-flex', alignItems: 'center', lineHeight: 0 }}>
      <Image className="via-logo-ink" src="/via-logo-ink.png" alt="VIA" width={width} height={height} priority />
      <Image className="via-logo-cream" src="/via-logo-cream.png" alt="VIA" width={width} height={height} priority />
    </span>
  );
}

export default Wordmark;
