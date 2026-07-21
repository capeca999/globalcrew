import { getSession } from './_auth.js';

export default async function handler(request, response) {
  const session = getSession(request);
  if (!session) return response.status(401).json({ authenticated: false });
  return response.status(200).json({ authenticated: true, username: session.username });
}
