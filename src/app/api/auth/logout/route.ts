import { NextResponse } from 'next/server';
import { deleteSession } from '@/lib/session';

export const runtime = 'nodejs';

function redirectToLogin() {
  return new NextResponse(null, {
    status: 303,
    headers: {
      Location: '/login',
    },
  });
}

export async function POST() {
  try {
    await deleteSession();
    return redirectToLogin();
  } catch (error) {
    console.error('Logout route failed:', error);
    return redirectToLogin();
  }
}
