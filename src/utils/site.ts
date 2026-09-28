/**
 * Hosting platforms give every project its own subdomain of a shared domain, so
 * two projects on the same platform are different *sites* as far as cookies are
 * concerned. Treat these like public suffixes when working out whether two hosts
 * belong together.
 */
const PLATFORM_SUFFIXES = [
  'vercel.app',
  'railway.app',
  'up.railway.app',
  'onrender.com',
  'netlify.app',
  'herokuapp.com',
  'pages.dev',
  'workers.dev',
  'fly.dev',
  'github.io',
  'azurewebsites.net',
  'appspot.com',
];

/**
 * The part of a host that decides its site: "api.daansetu.in" and
 * "www.daansetu.in" both reduce to "daansetu.in", while two Vercel projects keep
 * their own names because *.vercel.app is shared between unrelated sites.
 */
export function siteOf(host: string): string {
  const hostname = host.toLowerCase().trim().replace(/:\d+$/, '').replace(/\.$/, '');
  if (!hostname || hostname === 'localhost') return hostname;

  // An IP address is its own site.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':')) return hostname;

  const labels = hostname.split('.');
  if (labels.length <= 2) return hostname;

  for (const suffix of PLATFORM_SUFFIXES) {
    if (hostname === suffix) return hostname;
    if (hostname.endsWith(`.${suffix}`)) {
      return labels.slice(-(suffix.split('.').length + 1)).join('.');
    }
  }

  return labels.slice(-2).join('.');
}

/** Whether a browser would consider these two hosts the same site. */
export function isSameSite(a: string, b: string): boolean {
  const left = siteOf(a);
  const right = siteOf(b);
  return Boolean(left) && left === right;
}
