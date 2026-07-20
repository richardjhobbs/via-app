import Link from 'next/link';
import Image from 'next/image';
import { redirect } from 'next/navigation';
import { isAdminFromCookies } from '@/lib/app/auth';

export const dynamic = 'force-dynamic';

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  if (await isAdminFromCookies()) {
    redirect('/admin');
  }
  const { error, next } = await searchParams;

  return (
    <main className="min-h-screen bg-neutral-50 text-neutral-900 flex flex-col">
      <header className="bg-neutral-900 text-neutral-100">
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link href="/" aria-label="VIA home" className="inline-flex items-center">
            <Image src="/vialogowhite.png" alt="VIA" width={72} height={28} priority className="h-7 w-auto" />
          </Link>
          <span className="text-xs font-mono tracking-widest uppercase text-neutral-400">
            Superadmin
          </span>
        </div>
      </header>

      <section className="flex-1 px-6 py-16">
        <div className="max-w-md mx-auto">
          <p className="text-xs font-mono tracking-widest text-neutral-500 mb-3 uppercase">Admin</p>
          <h1 className="font-serif text-4xl leading-[1.1] tracking-tight mb-2">Sign in</h1>
          <p className="text-sm text-neutral-600 mb-8">
            Use your VIA account. Same email and password as the buyer and seller dashboards.
          </p>

          {error === 'bad-credentials' && (
            <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-md px-4 py-3 mb-6">
              Invalid email or password, or this account is not an admin.
            </div>
          )}
          {error === 'too-many' && (
            <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-md px-4 py-3 mb-6">
              Too many attempts. Please wait a minute and try again.
            </div>
          )}

          <form action="/api/admin/auth/login" method="post" className="space-y-5">
            <input type="hidden" name="next" value={next ?? '/admin'} />
            <div>
              <label htmlFor="email" className="block text-xs font-mono tracking-widest text-neutral-500 uppercase mb-2">
                Email
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                spellCheck={false}
                className="w-full bg-white border border-neutral-300 rounded-md px-4 py-3 font-mono text-sm focus:outline-none focus:border-neutral-900"
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-xs font-mono tracking-widest text-neutral-500 uppercase mb-2">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                spellCheck={false}
                className="w-full bg-white border border-neutral-300 rounded-md px-4 py-3 font-mono text-sm focus:outline-none focus:border-neutral-900"
              />
            </div>
            <button
              type="submit"
              className="w-full px-5 py-3 bg-neutral-900 text-neutral-50 text-xs font-mono tracking-widest uppercase hover:bg-neutral-800 transition-colors rounded-md"
            >
              Sign in
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
