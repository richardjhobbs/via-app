import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * Entry: routes the user into the right wizard for their role.
 * Anyone landing on /onboard without a role goes back to the home chooser.
 */
export default async function OnboardEntry({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  const { role } = await searchParams;
  if (role === 'seller') redirect('/onboard/account?role=seller');
  if (role === 'buyer')  redirect('/onboard/account?role=buyer');
  redirect('/');
}
