import Link from 'next/link';

/**
 * RRGFooter, Maison footer.
 *
 * Columns: brand, The Store, Clients, Trade.
 * Trade column highlights "Apply as a brand" in brass accent.
 * No Journal link. "Contact us" opens mailto:contact@getvia.xyz.
 */
export default function RRGFooter() {
  return (
    <footer className="maison-footer">
      <div className="foot-top">
        <div className="foot-brand">
          <div className="fb-mark">Real Real <em>Genuine</em></div>
          <p>A fashion-first commerce platform. Quietly agent-ready for the clients, concierges and curators who think ahead.</p>
        </div>

        <div className="foot-col">
          <h5>The Store</h5>
          <ul>
            <li><Link href="/rrg">Full Store</Link></li>
            <li><Link href="/brand">Brands</Link></li>
            <li><Link href="/cocreators">Co-creators</Link></li>
          </ul>
        </div>

        <div className="foot-col">
          <h5>Clients</h5>
          <ul>
            <li><Link href="/agents">Concierge</Link></li>
            <li><Link href="/agents">Personal shopper</Link></li>
            <li><a href="mailto:contact@getvia.xyz">Contact us</a></li>
          </ul>
        </div>

        <div className="foot-col">
          <h5>Trade</h5>
          <ul>
            <li><Link href="/create" className="highlight">Apply as a brand →</Link></li>
            <li><Link href="/cocreators">Co-creator briefs</Link></li>
            <li><a href="/mcp">Agent access (MCP)</a></li>
          </ul>
        </div>
      </div>

      {/* Connector row: LLM icons → /connect#<id> */}
      <div className="foot-connect">
        <span className="foot-connect-label">Connect your AI</span>
        <div className="foot-connect-icons">
          <Link href="/connect#claude" className="foot-connect-icon" aria-label="Claude">
            <svg width="16" height="16" viewBox="0 0 32 32" fill="none" aria-hidden="true"><circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="1.6" /><text x="16" y="21" textAnchor="middle" fontFamily="serif" fontSize="15" fontStyle="italic" fill="currentColor">C</text></svg>
            <span>Claude</span>
          </Link>
          <Link href="/connect#chatgpt" className="foot-connect-icon" aria-label="ChatGPT">
            <svg width="16" height="16" viewBox="0 0 32 32" fill="none" aria-hidden="true"><circle cx="16" cy="16" r="14" stroke="currentColor" strokeWidth="1.6" /><path d="M10 13l6 6 6-6" stroke="currentColor" strokeWidth="1.6" fill="none" /></svg>
            <span>ChatGPT</span>
          </Link>
          <Link href="/connect#gemini" className="foot-connect-icon" aria-label="Gemini">
            <svg width="16" height="16" viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M16 4l3 9 9 3-9 3-3 9-3-9-9-3 9-3z" stroke="currentColor" strokeWidth="1.6" fill="none" /></svg>
            <span>Gemini</span>
          </Link>
          <Link href="/connect#grok" className="foot-connect-icon" aria-label="Grok">
            <svg width="16" height="16" viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M6 6l20 20M26 6L6 26" stroke="currentColor" strokeWidth="1.8" /></svg>
            <span>Grok</span>
          </Link>
          <Link href="/connect#perplexity" className="foot-connect-icon" aria-label="Perplexity">
            <svg width="16" height="16" viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M16 4v24M4 16h24M9 9l14 14M23 9L9 23" stroke="currentColor" strokeWidth="1.4" /></svg>
            <span>Perplexity</span>
          </Link>
          <Link href="/connect#custom" className="foot-connect-icon" aria-label="Custom MCP agent">
            <svg width="16" height="16" viewBox="0 0 32 32" fill="none" aria-hidden="true"><rect x="5" y="10" width="22" height="14" rx="1" stroke="currentColor" strokeWidth="1.6" /><path d="M10 16h12M10 20h8" stroke="currentColor" strokeWidth="1.4" /></svg>
            <span>Custom MCP</span>
          </Link>
        </div>
      </div>

      <div className="foot-bot">
        <div>© 2026 Real Real Genuine, all rights reserved</div>

        <div className="foot-socials">
          <a href="https://discord.gg/x26cwNT8" target="_blank" rel="noopener noreferrer" aria-label="Discord">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>
          </a>
          <a href="https://bsky.app/profile/realrealgenuine.bsky.social" target="_blank" rel="noopener noreferrer" aria-label="BlueSky">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 10.8c-1.087-2.114-4.046-6.053-6.798-7.995C2.566.944 1.561 1.266.902 1.565.139 1.908 0 3.08 0 3.768c0 .69.378 5.65.624 6.479.785 2.627 3.6 3.492 6.208 3.054-.496.626-2.475 2.162-1.37 4.33 2.261 4.437 5.28.467 6.538-1.586 1.258 2.053 2.583 5.22 5.707 4.347 2.494-.698 2.242-3.39 1.407-4.58-.52-.742-1.283-1.404-1.7-1.762 2.607.438 5.422-.427 6.208-3.054.245-.829.624-5.789.624-6.478 0-.69-.139-1.861-.902-2.206-.66-.298-1.664-.62-4.3 1.24C16.046 4.748 13.087 8.687 12 10.8z"/></svg>
          </a>
          <a href="https://t.me/realrealgenuine" target="_blank" rel="noopener noreferrer" aria-label="Telegram">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>
          </a>
          <a href="https://instagram.com/realrealgenuine" target="_blank" rel="noopener noreferrer" aria-label="Instagram">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"/></svg>
          </a>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/rrg/faq">FAQ</Link>
          <a
            href="https://8004scan.io/agents/base/33313"
            target="_blank"
            rel="noopener noreferrer"
            className="agent-badge"
            style={{ textDecoration: 'none' }}
          ><span className="d"></span>Registry #33313, ERC-8004, Base</a>
          <span>
            Powered by{' '}
            <a
              href="https://getvia.xyz"
              target="_blank"
              rel="noopener noreferrer"
              className="via-labs-link"
            >
              VIA Labs ↗
            </a>
          </span>
        </div>
      </div>
    </footer>
  );
}
