export const dynamic = 'force-static';

const BODY = [
  '# RRG robots.txt',
  '# Content Signals per https://contentsignals.org/',
  '',
  'User-agent: *',
  'Allow: /',
  'Disallow: /admin/',
  'Disallow: /api/',
  'Content-Signal: search=yes, ai-train=yes, ai-input=yes',
  '',
  'User-agent: GPTBot',
  'Allow: /',
  'Content-Signal: search=yes, ai-train=yes, ai-input=yes',
  '',
  'User-agent: ClaudeBot',
  'Allow: /',
  'Content-Signal: search=yes, ai-train=yes, ai-input=yes',
  '',
  'User-agent: Claude-Web',
  'Allow: /',
  'Content-Signal: search=yes, ai-train=yes, ai-input=yes',
  '',
  'User-agent: PerplexityBot',
  'Allow: /',
  'Content-Signal: search=yes, ai-train=yes, ai-input=yes',
  '',
  'User-agent: Google-Extended',
  'Allow: /',
  'Content-Signal: search=yes, ai-train=yes, ai-input=yes',
  '',
  'User-agent: CCBot',
  'Allow: /',
  'Content-Signal: search=yes, ai-train=yes, ai-input=yes',
  '',
  'Sitemap: https://realrealgenuine.com/sitemap.xml',
  'Host: https://realrealgenuine.com',
  '',
].join('\n');

export function GET() {
  return new Response(BODY, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
