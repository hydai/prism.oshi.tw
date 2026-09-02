/**
 * Verify a Turnstile token server-side.
 * Returns true only for a valid token and throws when Siteverify is unavailable.
 */
export async function verifyTurnstile(
  secretKey: string,
  token: string,
  remoteIp?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const body = new URLSearchParams({
    secret: secretKey,
    response: token,
  });
  if (remoteIp) {
    body.set('remoteip', remoteIp);
  }

  const res = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body,
  });

  if (!res.ok) {
    throw new Error(`Turnstile verification failed with status ${res.status}`);
  }

  const data: unknown = await res.json();
  return typeof data === 'object' && data !== null && 'success' in data && data.success === true;
}
