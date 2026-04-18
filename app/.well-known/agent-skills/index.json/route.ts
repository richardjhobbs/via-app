import { SKILLS } from '../_skills';

export const dynamic = 'force-static';

const INDEX = {
  $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
  skills: SKILLS.map(({ name, type, description, url, digest }) => ({
    name,
    type,
    description,
    url,
    digest,
  })),
};

export function GET() {
  return new Response(JSON.stringify(INDEX, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
