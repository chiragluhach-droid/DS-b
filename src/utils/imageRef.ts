import { z } from 'zod';

/**
 * Hosts the web app is configured to render images from (next.config.ts
 * remotePatterns). An image from anywhere else would fail to render, so it is
 * rejected here with an explanation rather than saved and shown broken.
 */
export const ALLOWED_IMAGE_HOSTS = ['images.unsplash.com', 'res.cloudinary.com'];

export const imageRef = z.string().trim().max(600).refine((value) => {
  // A root-relative path is served from the web app's own /public directory.
  if (value.startsWith('/')) return true;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ALLOWED_IMAGE_HOSTS.includes(url.hostname);
  } catch {
    return false;
  }
}, `Use an https image link from ${ALLOWED_IMAGE_HOSTS.join(' or ')}`);
