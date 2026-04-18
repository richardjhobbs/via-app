import { SKILLS } from '../../_skills';

export const dynamic = 'force-static';

const CONTENT = SKILLS.find((s) => s.name === 'rrg-submit-design')!.content;

export function GET() {
  return new Response(CONTENT, {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
