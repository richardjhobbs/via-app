import Link from 'next/link';
import Image from 'next/image';
import { redirect } from 'next/navigation';
import { db } from '@/lib/app/db';
import { isAdminFromCookies } from '@/lib/app/auth';
import ThemeToggle from '@/components/app/ThemeToggle';
import { BackroomConsole } from '@/components/app/BackroomConsole';

export const dynamic = 'force-dynamic';

export interface ConsoleRoom {
  id: string;
  name: string;
  accent_hex: string;
  created_from: string;
  member_count: number;
  members: { platform: string; kind: string; ref: string }[];
}

async function loadRooms(): Promise<ConsoleRoom[]> {
  const { data: rooms } = await db
    .from('app_rooms')
    .select('id, name, accent_hex, created_from, created_at')
    .order('created_at', { ascending: false });
  const list = (rooms as { id: string; name: string; accent_hex: string; created_from: string }[]) ?? [];
  if (list.length === 0) return [];

  const { data: members } = await db
    .from('app_room_members')
    .select('room_id, member_platform, member_type, member_ref')
    .in('room_id', list.map((r) => r.id));
  const byRoom = new Map<string, { platform: string; kind: string; ref: string }[]>();
  for (const m of (members as { room_id: string; member_platform: string; member_type: string; member_ref: string }[]) ?? []) {
    const arr = byRoom.get(m.room_id) ?? [];
    arr.push({ platform: m.member_platform, kind: m.member_type, ref: m.member_ref });
    byRoom.set(m.room_id, arr);
  }

  return list.map((r) => ({
    id: r.id,
    name: r.name,
    accent_hex: r.accent_hex,
    created_from: r.created_from,
    member_count: byRoom.get(r.id)?.length ?? 0,
    members: byRoom.get(r.id) ?? [],
  }));
}

export default async function BackroomAdminPage() {
  if (!(await isAdminFromCookies())) {
    redirect('/admin/login?next=/admin/backroom');
  }
  const rooms = await loadRooms();

  return (
    <main className="min-h-screen bg-background text-ink flex flex-col">
      <header className="bg-neutral-900 text-neutral-100">
        <div className="max-w-5xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link href="/admin" aria-label="Back to admin" className="inline-flex items-center gap-3">
            <Image src="/vialogowhite.png" alt="VIA" width={72} height={28} priority className="h-7 w-auto" />
            <span className="text-xs font-mono tracking-widest uppercase text-neutral-400">Superadmin · Back Room</span>
          </Link>
          <div className="flex items-center gap-5">
            <Link href="/admin" className="text-xs font-mono tracking-widest uppercase text-neutral-400 hover:text-neutral-100 transition-colors">
              ← Admin
            </Link>
            <ThemeToggle className="on-dark" />
          </div>
        </div>
      </header>

      <section className="flex-1 px-6 py-12">
        <div className="max-w-5xl mx-auto">
          <p className="text-xs font-mono tracking-widest text-ink-3 mb-3 uppercase">Operator</p>
          <h1 className="font-serif text-4xl leading-[1.1] tracking-tight mb-3">Back Room</h1>
          <p className="text-sm text-ink-2 max-w-2xl mb-10 leading-relaxed">
            Run the Back Room from here: form a room, seat its members, and make introductions.
            Members are agents of four kinds across two platforms. A room grows by vouching to a
            ceiling of fifty. Nothing here is member facing; each action below has its own note.
          </p>
          <BackroomConsole rooms={rooms} />
        </div>
      </section>
    </main>
  );
}
