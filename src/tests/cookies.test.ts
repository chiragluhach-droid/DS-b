import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { siteOf, isSameSite } from '../utils/site';
import { createFixture, resetDatabase, startTestServer, stopTestServer, PASSWORD } from './helpers';

before(startTestServer);
after(stopTestServer);
beforeEach(resetDatabase);

test('hosts are grouped into sites the way a browser groups them', () => {
  assert.equal(siteOf('api.daansetu.in'), 'daansetu.in');
  assert.equal(siteOf('www.daansetu.in'), 'daansetu.in');
  assert.equal(siteOf('daansetu.in'), 'daansetu.in');
  assert.equal(siteOf('localhost:3000'), 'localhost');

  assert.ok(isSameSite('daansetu.in', 'api.daansetu.in'));
  assert.ok(isSameSite('localhost:3000', 'localhost:5001'));

  // Every project gets its own subdomain of these, so they are separate sites.
  assert.equal(siteOf('daansetu-rose.vercel.app'), 'daansetu-rose.vercel.app');
  assert.ok(!isSameSite('daansetu-rose.vercel.app', 'daansetu-api.up.railway.app'));
  assert.ok(!isSameSite('daansetu-rose.vercel.app', 'other-project.vercel.app'));
  assert.ok(!isSameSite('daansetu.in', 'evil.com'));
});

/**
 * The bug this guards against: a Lax cookie sent to a web app on another domain
 * is dropped by the browser, so the user appears signed in until their next
 * request and is then bounced back to the sign-in page.
 */
test('signing in from another domain gets a cookie the browser will send back', async () => {
  await createFixture();

  const res = await fetch(`${process.env.TEST_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://daansetu-rose.vercel.app',
      'X-Forwarded-Proto': 'https',
    },
    body: JSON.stringify({ email: 'kitchen@test.in', password: PASSWORD }),
  });

  const cookies = res.headers.getSetCookie();
  assert.equal(res.status, 200);
  assert.ok(cookies.length >= 2, 'expected an access and a refresh cookie');

  for (const cookie of cookies) {
    assert.match(cookie, /SameSite=None/i, `cross-site cookie must be SameSite=None: ${cookie}`);
    assert.match(cookie, /Secure/i, 'SameSite=None is only honoured on a Secure cookie');
    assert.match(cookie, /HttpOnly/i, 'the session must stay out of reach of scripts');
  }
});

test('signing in from the same site keeps the stricter Lax cookie', async () => {
  await createFixture();

  const res = await fetch(`${process.env.TEST_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // The test server's own host, i.e. the web app and API on one site.
      Origin: process.env.TEST_BASE_URL!.replace('/api', ''),
    },
    body: JSON.stringify({ email: 'kitchen@test.in', password: PASSWORD }),
  });

  assert.equal(res.status, 200);
  for (const cookie of res.headers.getSetCookie()) {
    assert.match(cookie, /SameSite=Lax/i);
  }
});

test('an insecure cross-site origin falls back to Lax rather than a dropped cookie', async () => {
  await createFixture();

  const res = await fetch(`${process.env.TEST_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://some-other-host.test',
    },
    body: JSON.stringify({ email: 'kitchen@test.in', password: PASSWORD }),
  });

  assert.equal(res.status, 200);
  for (const cookie of res.headers.getSetCookie()) {
    assert.match(cookie, /SameSite=Lax/i);
    assert.ok(!/Secure/i.test(cookie), 'a Secure cookie would be ignored over plain http');
  }
});

test('the session cookie actually authenticates the next request', async () => {
  const fx = await createFixture();

  const login = await fetch(`${process.env.TEST_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://daansetu-rose.vercel.app',
      'X-Forwarded-Proto': 'https',
    },
    body: JSON.stringify({ email: 'kitchen@test.in', password: PASSWORD }),
  });

  const jar = login.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');

  const me = await fetch(`${process.env.TEST_BASE_URL}/restaurants/me`, {
    headers: { Cookie: jar, Origin: 'https://daansetu-rose.vercel.app' },
  });
  const body = (await me.json()) as { data?: { restaurant?: { _id?: string } } };

  assert.equal(me.status, 200, 'the dashboard must load with only the cookie');
  assert.equal(body.data?.restaurant?._id, fx.restaurant.id);
});
