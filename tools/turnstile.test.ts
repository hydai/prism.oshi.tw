import assert from 'node:assert/strict';
import { verifyTurnstile as verifyNovaTurnstile } from './nova/src/turnstile';
import { verifyTurnstile as verifyCrystalTurnstile } from './crystal/src/turnstile';

type VerifyTurnstile = typeof verifyNovaTurnstile;

const implementations: Array<[name: string, verify: VerifyTurnstile]> = [
  ['Nova', verifyNovaTurnstile],
  ['Crystal', verifyCrystalTurnstile],
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function main(): Promise<void> {
  for (const [name, verify] of implementations) {
    const requests: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const successFetch: typeof fetch = async (input, init) => {
      requests.push({ input, init });
      return jsonResponse({ success: true });
    };

    assert.equal(
      await verify('secret-key', 'token-value', '203.0.113.10', successFetch),
      true,
      `${name} accepts a successful Siteverify response`,
    );
    assert.equal(String(requests[0].input), 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
    assert.equal(requests[0].init?.method, 'POST');
    assert.equal(
      String(requests[0].init?.body),
      'secret=secret-key&response=token-value&remoteip=203.0.113.10',
      `${name} forwards the expected Siteverify fields`,
    );

    const invalidFetch: typeof fetch = async () => jsonResponse({
      success: false,
      'error-codes': ['timeout-or-duplicate'],
    });
    assert.equal(
      await verify('secret-key', 'expired-token', undefined, invalidFetch),
      false,
      `${name} rejects a token that Siteverify marks invalid`,
    );

    const malformedFetch: typeof fetch = async () => jsonResponse({ success: 'true' });
    assert.equal(
      await verify('secret-key', 'token-value', undefined, malformedFetch),
      false,
      `${name} only accepts the literal boolean success value`,
    );

    const unavailableFetch: typeof fetch = async () => jsonResponse({ success: true }, 503);
    await assert.rejects(
      () => verify('secret-key', 'token-value', undefined, unavailableFetch),
      /Turnstile verification failed with status 503/,
      `${name} fails closed when Siteverify returns a non-success status`,
    );

    console.log(`✓ ${name} validates Siteverify status and response shape`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
