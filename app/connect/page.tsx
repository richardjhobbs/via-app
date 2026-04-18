import Link from 'next/link';
import type { Metadata } from 'next';
import RRGHeader from '@/components/rrg/RRGHeader';
import RRGFooter from '@/components/rrg/RRGFooter';

const MCP_ENDPOINT = 'https://realrealgenuine.com/mcp';

export const metadata: Metadata = {
  title: 'Connect your AI assistant, Real Real Genuine',
  description: 'Install the RRG MCP server into Claude, ChatGPT, Gemini, Grok, Perplexity, or any MCP-compatible agent.',
};

type Connector = {
  id: string;
  name: string;
  tagline: string;
  approach: 'config' | 'ui' | 'url';
  steps: (string | { code: string })[];
  docs: string;
};

const CONNECTORS: Connector[] = [
  {
    id: 'claude',
    name: 'Claude',
    tagline: 'Claude Desktop, Claude Code, or claude.ai (Pro / Max).',
    approach: 'config',
    steps: [
      'Open Claude Desktop → Settings → Developer → Edit Config.',
      'Add the RRG server to your `mcpServers` block:',
      { code: `{
  "mcpServers": {
    "rrg": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://realrealgenuine.com/mcp"]
    }
  }
}` },
      'Save, then fully quit and relaunch Claude Desktop.',
      'Ask Claude: "What can you do with the RRG server?"',
    ],
    docs: 'https://getvia.xyz/connect/claude',
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    tagline: 'ChatGPT Plus / Pro / Business / Enterprise, via agent / developer mode.',
    approach: 'url',
    steps: [
      'In ChatGPT, enable Developer Mode (Settings → Beta features).',
      'Go to Settings → Connectors → Add custom connector.',
      'Paste the RRG endpoint:',
      { code: MCP_ENDPOINT },
      'Authorise when prompted. Start a new chat and ask for listings or to place an order.',
    ],
    docs: 'https://getvia.xyz/connect/chatgpt',
  },
  {
    id: 'gemini',
    name: 'Gemini',
    tagline: 'Google Gemini Advanced, via the MCP-compatible extension layer.',
    approach: 'ui',
    steps: [
      'In Gemini, open Extensions / Connectors.',
      'Add a new MCP server and paste the RRG endpoint:',
      { code: MCP_ENDPOINT },
      'Grant the permissions Gemini asks for.',
      'Try: "Find me the latest Maison pieces under $300."',
    ],
    docs: 'https://getvia.xyz/connect/gemini',
  },
  {
    id: 'grok',
    name: 'Grok',
    tagline: 'xAI Grok with MCP integration.',
    approach: 'url',
    steps: [
      'In Grok, open the integrations panel.',
      'Add a new MCP connector with the endpoint:',
      { code: MCP_ENDPOINT },
      'Accept the permissions prompt.',
      'Ask Grok to search RRG or place an order.',
    ],
    docs: 'https://getvia.xyz/connect/grok',
  },
  {
    id: 'perplexity',
    name: 'Perplexity',
    tagline: 'Perplexity Pro, via Spaces or the connector panel.',
    approach: 'url',
    steps: [
      'Open Perplexity → Spaces → Create Space → Add connector.',
      'Select MCP (custom) and paste the endpoint:',
      { code: MCP_ENDPOINT },
      'Save. Ask inside the Space: "Show me the latest drops on RRG."',
    ],
    docs: 'https://getvia.xyz/connect/perplexity',
  },
];

export default function ConnectPage() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', color: 'var(--ink)' }}>
      <RRGHeader active="concierge" />

      <main>
        {/* ─── Hero ─── */}
        <section className="page-pad" style={{ maxWidth: 1100, paddingTop: 24, paddingBottom: 16 }}>
          <div className="section-note" style={{ marginBottom: 8 }}>§ Connect</div>
          <h1 style={{
            fontFamily: 'var(--font-fraunces), serif',
            fontVariationSettings: '"opsz" 144, "wght" 300',
            fontSize: 'clamp(44px, 5.8vw, 80px)',
            letterSpacing: '-0.025em',
            lineHeight: 1.02,
            margin: '0 0 20px',
          }}>
            Bring RRG into your <em>AI assistant.</em>
          </h1>
          <p style={{ fontSize: 17, color: 'var(--ink-2)', lineHeight: 1.65, maxWidth: '62ch', fontWeight: 300, marginBottom: 24 }}>
            Real Real Genuine speaks MCP, the standard protocol for AI tool use.
            Install the RRG server into the assistant you already use, or point your own agent
            straight at the endpoint. Humans and agents land at the same counter.
          </p>
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 12,
            padding: '12px 18px',
            background: 'var(--paper)',
            border: '1px solid var(--line-strong)',
          }}>
            <span className="uc-mono" style={{ color: 'var(--ink-3)' }}>Endpoint</span>
            <code style={{
              fontFamily: 'var(--font-jetbrains), monospace',
              fontSize: 13,
              color: 'var(--accent)',
              letterSpacing: '0.01em',
            }}>{MCP_ENDPOINT}</code>
          </div>
        </section>

        {/* ─── Assistant jump list ─── */}
        <section className="page-pad" style={{ maxWidth: 1100, paddingTop: 0, paddingBottom: 32 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {CONNECTORS.map(c => (
              <a key={c.id} href={`#${c.id}`} className="chip">
                {c.name}
              </a>
            ))}
            <a href="#custom" className="chip">Custom agent</a>
          </div>
        </section>

        {/* ─── Per-LLM instructions ─── */}
        {CONNECTORS.map(c => (
          <section
            key={c.id}
            id={c.id}
            className="page-pad"
            style={{ maxWidth: 1100, paddingTop: 40, paddingBottom: 40, borderTop: '1px solid var(--line)', scrollMarginTop: 80 }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) 2.2fr', gap: 56, alignItems: 'flex-start' }}>
              <div>
                <div className="section-note" style={{ marginBottom: 8 }}>§ {c.id}</div>
                <h2 style={{
                  fontFamily: 'var(--font-fraunces), serif',
                  fontSize: 36,
                  fontWeight: 300,
                  letterSpacing: '-0.02em',
                  lineHeight: 1.05,
                  margin: '0 0 14px',
                }}>
                  {c.name}
                </h2>
                <p style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.6, margin: '0 0 18px', maxWidth: '32ch', fontWeight: 300 }}>
                  {c.tagline}
                </p>
                <a
                  href={c.docs}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontFamily: 'var(--font-jetbrains), monospace',
                    fontSize: 11,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    color: 'var(--ink-2)',
                    borderBottom: '1px solid var(--line-strong)',
                    paddingBottom: 2,
                    textDecoration: 'none',
                  }}
                >
                  Full guide on getvia.xyz ↗
                </a>
              </div>

              <ol style={{
                listStyle: 'none',
                counterReset: 'step-counter',
                padding: 0,
                margin: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
              }}>
                {c.steps.map((s, i) => {
                  if (typeof s === 'string') {
                    return (
                      <li key={i} style={{
                        counterIncrement: 'step-counter',
                        position: 'relative',
                        paddingLeft: 36,
                        fontSize: 15,
                        color: 'var(--ink)',
                        lineHeight: 1.55,
                      }}>
                        <span style={{
                          position: 'absolute',
                          left: 0,
                          top: 0,
                          width: 24,
                          height: 24,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontFamily: 'var(--font-jetbrains), monospace',
                          fontSize: 10,
                          letterSpacing: 0,
                          color: 'var(--accent)',
                          border: '1px solid var(--line-strong)',
                          borderRadius: 99,
                        }}>
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        {renderStepText(s)}
                      </li>
                    );
                  }
                  return (
                    <li key={i} style={{ paddingLeft: 36, listStyle: 'none' }}>
                      <pre style={{
                        margin: 0,
                        padding: 16,
                        background: 'var(--bg-2)',
                        border: '1px solid var(--line)',
                        fontFamily: 'var(--font-jetbrains), monospace',
                        fontSize: 12.5,
                        lineHeight: 1.55,
                        color: 'var(--ink)',
                        overflow: 'auto',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                      }}>{s.code}</pre>
                    </li>
                  );
                })}
              </ol>
            </div>
          </section>
        ))}

        {/* ─── Custom agent ─── */}
        <section
          id="custom"
          className="page-pad"
          style={{ maxWidth: 1100, paddingTop: 40, paddingBottom: 80, borderTop: '1px solid var(--line)', scrollMarginTop: 80 }}
        >
          <div className="section-note" style={{ marginBottom: 8 }}>§ Custom</div>
          <h2 style={{
            fontFamily: 'var(--font-fraunces), serif',
            fontSize: 36,
            fontWeight: 300,
            letterSpacing: '-0.02em',
            lineHeight: 1.05,
            margin: '0 0 14px',
          }}>
            Build your own agent.
          </h2>
          <p style={{ fontSize: 16, color: 'var(--ink-2)', lineHeight: 1.6, maxWidth: '62ch', fontWeight: 300, margin: '0 0 20px' }}>
            RRG is an MCP Streamable HTTP server. Point any MCP-compatible client at the endpoint.
            Identity and trust are handled via ERC-8004 signals, on Base mainnet.
          </p>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 32 }}>
            <Link href="/agents" className="btn">
              Get a concierge of your own <span className="arrow">→</span>
            </Link>
            <a
              href="https://8004scan.io/agents/base/33313"
              target="_blank"
              rel="noopener noreferrer"
              className="btn ghost"
            >
              View agent #33313 on 8004scan ↗
            </a>
          </div>

          <div className="pdp-agent" style={{ margin: 0, maxWidth: 720 }}>
            <div className="pdp-agent-head">
              <span className="tag">Quick reference</span>
              <span className="sub">For MCP-compatible clients</span>
            </div>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 14, lineHeight: 1.9 }}>
              <li style={{ display: 'flex', gap: 12 }}>
                <span style={{ minWidth: 110, color: 'var(--ink-3)', fontFamily: 'var(--font-jetbrains), monospace', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Transport</span>
                <span style={{ color: 'var(--ink)' }}>HTTP (Streamable), stateless, JSON response</span>
              </li>
              <li style={{ display: 'flex', gap: 12 }}>
                <span style={{ minWidth: 110, color: 'var(--ink-3)', fontFamily: 'var(--font-jetbrains), monospace', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Endpoint</span>
                <code style={{ color: 'var(--accent)', fontFamily: 'var(--font-jetbrains), monospace', fontSize: 13 }}>{MCP_ENDPOINT}</code>
              </li>
              <li style={{ display: 'flex', gap: 12 }}>
                <span style={{ minWidth: 110, color: 'var(--ink-3)', fontFamily: 'var(--font-jetbrains), monospace', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Agent card</span>
                <a href="https://realrealgenuine.com/agent.json" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--ink-2)', fontFamily: 'var(--font-jetbrains), monospace', fontSize: 13, borderBottom: '1px solid var(--line-strong)', textDecoration: 'none' }}>
                  /agent.json
                </a>
              </li>
              <li style={{ display: 'flex', gap: 12 }}>
                <span style={{ minWidth: 110, color: 'var(--ink-3)', fontFamily: 'var(--font-jetbrains), monospace', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Identity</span>
                <span style={{ color: 'var(--ink)' }}>ERC-8004 agent <em style={{ color: 'var(--accent)', fontFamily: 'var(--font-fraunces), serif' }}>#33313</em> on Base</span>
              </li>
            </ul>
          </div>
        </section>
      </main>

      <RRGFooter />
    </div>
  );
}

/** Render inline `code` backticks inside step text as monospace spans. */
function renderStepText(s: string): React.ReactNode {
  const parts = s.split(/(`[^`]+`)/g);
  return parts.map((p, i) => {
    if (p.startsWith('`') && p.endsWith('`')) {
      return (
        <code key={i} style={{
          fontFamily: 'var(--font-jetbrains), monospace',
          fontSize: 13,
          color: 'var(--accent)',
          background: 'var(--bg-2)',
          padding: '1px 6px',
        }}>
          {p.slice(1, -1)}
        </code>
      );
    }
    return <span key={i}>{p}</span>;
  });
}
