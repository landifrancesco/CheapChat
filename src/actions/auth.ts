'use server';

import { prisma } from '@/lib/prisma';
import { createSession, deleteSession } from '@/lib/session';
import { redirect } from 'next/navigation';

type LoginActionState = {
  error?: string;
} | null;

export async function loginAction(_prevState: LoginActionState, formData: FormData) {
  const password = formData.get('password');
  const APP_PASSWORD = process.env.APP_PASSWORD;

  if (!password || password !== APP_PASSWORD) {
    return { error: 'Invalid password' };
  }

  try {
    // Create a new anonymous visitor identity
    const visitor = await prisma.visitor.create({
      data: {},
    });

    // Assign a persistent session to this visitor
    await createSession(visitor.id);
  } catch (error) {
    console.error('Failed to create visitor session', error);
    return { error: 'Unable to start your session right now. Please retry in a few seconds.' };
  }

  // Redirect handles response throw under the hood
  redirect('/');
}

export async function logoutAction() {
  await deleteSession();
  redirect('/login');
}
