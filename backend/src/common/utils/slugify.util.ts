/** Lowercase, dash-separated slug from a display name (e.g. tenant name). */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90);
}

/** Appends a short random suffix, used to resolve a slug collision. */
export function withRandomSuffix(slug: string): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${slug.slice(0, 90 - suffix.length - 1)}-${suffix}`;
}
