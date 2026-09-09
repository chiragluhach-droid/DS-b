import { z } from 'zod';

/**
 * An image reference is either a full URL or a root-relative path to a file
 * served from the web app's /public directory.
 */
export const imageRef = z
  .string()
  .refine(
    (v) => /^https?:\/\//.test(v) || v.startsWith('/'),
    'Enter a full URL, or a path beginning with /'
  );
