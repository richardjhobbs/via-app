const PLATFORMS = [
  { name: 'Claude',     href: '/connect#claude' },
  { name: 'ChatGPT',    href: '/connect#chatgpt' },
  { name: 'Gemini',     href: '/connect#gemini' },
  { name: 'Grok',       href: '/connect#grok' },
  { name: 'Perplexity', href: '/connect#perplexity' },
];

const MCP_ENDPOINT = 'https://realrealgenuine.com/mcp';
const CONNECT_HUB  = '/connect';

/**
 * Connectors block: how humans and agents reach RRG.
 * Used on the landing page after §04, quiet magazine-style presentation.
 */
export default function ShopWithAI() {
  return (
    <section className="maison-section" style={{ paddingTop: 0 }}>
      <div className="section-head">
        <div>
          <div className="section-note">§ 06, connectors</div>
          <h3>Shop RRG through your <em>AI assistant.</em></h3>
        </div>
        <div className="sh-right">
          <a href={CONNECT_HUB}>All connect guides →</a>
        </div>
      </div>

      <p style={{
        fontSize: 16,
        color: 'var(--ink-2)',
        lineHeight: 1.65,
        maxWidth: '58ch',
        fontWeight: 300,
        margin: '0 0 32px',
      }}>
        Real Real Genuine is built for both. Browse the site like any other boutique,
        or hand the shopping to the AI assistant you already use.
      </p>

      <div className="collab-inner" style={{ padding: 0, marginBottom: 0 }}>
        <div className="collab-card" style={{ minHeight: 0, padding: '32px 32px 28px' }}>
          <div className="tag-line">
            <span className="uc-mono" style={{ color: 'var(--accent)' }}>For humans</span>
            <span className="uc-mono" style={{ color: 'var(--ink-3)' }}>
              <span style={{ display: 'inline-block', width: 5, height: 5, background: 'var(--live)', borderRadius: 99, marginRight: 6 }}></span>
              Live
            </span>
          </div>
          <div>
            <h4 style={{ fontSize: 26, marginBottom: 10 }}>Use your AI assistant.</h4>
            <p>Install the RRG server into Claude, ChatGPT, Gemini, Grok, or Perplexity. Step-by-step guides for each:</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 20 }}>
              {PLATFORMS.map((p) => (
                <a
                  key={p.name}
                  href={p.href}
                  className="chip"
                >
                  {p.name}
                </a>
              ))}
            </div>
          </div>
        </div>

        <div className="collab-card" style={{ minHeight: 0, padding: '32px 32px 28px' }}>
          <div className="tag-line">
            <span className="uc-mono" style={{ color: 'var(--accent)' }}>For agents</span>
            <span className="uc-mono" style={{ color: 'var(--ink-3)' }}>MCP</span>
          </div>
          <div>
            <h4 style={{ fontSize: 26, marginBottom: 10 }}>Point your agent at the endpoint.</h4>
            <p>Building your own agent or Personal Shopper? Drop the endpoint straight in:</p>
            <div style={{ marginTop: 20 }}>
              <a
                href={MCP_ENDPOINT}
                target="_blank"
                rel="noopener noreferrer"
                className="chip"
                style={{ fontSize: 11 }}
              >
                realrealgenuine.com/mcp ↗
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
