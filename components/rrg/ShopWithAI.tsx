const PLATFORMS = [
  { name: 'Claude',     href: 'https://getvia.xyz/connect/claude' },
  { name: 'ChatGPT',    href: 'https://getvia.xyz/connect/chatgpt' },
  { name: 'Gemini',     href: 'https://getvia.xyz/connect/gemini' },
  { name: 'Grok',       href: 'https://getvia.xyz/connect/grok' },
  { name: 'Perplexity', href: 'https://getvia.xyz/connect/perplexity' },
];

const MCP_ENDPOINT = 'https://realrealgenuine.com/mcp';
const CONNECT_HUB  = 'https://getvia.xyz/connect';

export default function ShopWithAI() {
  return (
    <section className="mb-8">
      <div className="border border-white/10 rounded-lg p-6 sm:p-8">
        <div className="flex items-center gap-2 mb-4">
          <span className="relative flex w-2 h-2">
            <span className="absolute inline-flex w-full h-full rounded-full bg-green-500 opacity-60 animate-ping" />
            <span className="relative inline-flex w-2 h-2 rounded-full bg-green-500" />
          </span>
          <span className="text-sm font-mono uppercase tracking-[0.3em] text-white/60">
            Live · Humans &amp; Agents Welcome
          </span>
        </div>

        <h2 className="text-3xl sm:text-4xl font-light leading-snug mb-4">
          Shop RRG through your AI assistant.
        </h2>

        <p className="text-base text-white/80 leading-relaxed mb-6 max-w-3xl">
          Real Real Genuine is built for both. Browse the site like any other boutique —
          or hand the shopping to the AI assistant you already use.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div className="border border-white/10 rounded-lg p-6 flex flex-col">
            <h3 className="text-sm font-mono uppercase tracking-wider text-white/60 mb-3">
              Use your AI assistant
            </h3>
            <p className="text-white/80 text-sm leading-relaxed mb-4">
              Install the RRG server into Claude, ChatGPT, Gemini, Grok, or Perplexity.
              Step-by-step guides for each:
            </p>
            <div className="flex flex-wrap gap-2 mt-auto">
              {PLATFORMS.map((p) => (
                <a
                  key={p.name}
                  href={p.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center border border-white/15 hover:border-green-500/60 hover:text-green-300 text-white/90 rounded-full px-4 py-1.5 text-sm transition-colors"
                >
                  {p.name}
                </a>
              ))}
            </div>
          </div>

          <div className="border border-white/10 rounded-lg p-6 flex flex-col">
            <h3 className="text-sm font-mono uppercase tracking-wider text-white/60 mb-3">
              Point your own agent at the MCP
            </h3>
            <p className="text-white/80 text-sm leading-relaxed mb-4">
              Building your own agent or Personal Shopper? Drop the endpoint straight in:
            </p>
            <a
              href={MCP_ENDPOINT}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center self-start border border-white/15 hover:border-green-500/60 hover:text-green-300 text-white/90 rounded-full px-4 py-2 font-mono text-sm transition-colors mt-auto"
            >
              realrealgenuine.com/mcp
            </a>
          </div>
        </div>

        <div className="flex justify-center">
          <a
            href={CONNECT_HUB}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center bg-green-500 text-black rounded-full px-6 py-2.5 font-medium text-sm hover:bg-green-400 transition-colors"
          >
            See all connect guides &rarr;
          </a>
        </div>
      </div>
    </section>
  );
}
