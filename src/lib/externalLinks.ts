/**
 * Deep links to external book sites, built from real ISBN/ASIN metadata when
 * present, with a title+author search fallback. Goodreads, Audible, and
 * Hardcover are shown until an admin integrations surface lets servers pick.
 */
export interface ExternalLink {
  key: string
  icon: string
  label: string
  href: string
}

export function externalLinks(opts: {
  title: string
  author: string
  isbn: string | null
  asin: string | null
}): ExternalLink[] {
  const q = encodeURIComponent(`${opts.title ?? ''} ${opts.author ?? ''}`.trim())
  return [
    {
      key: 'goodreads',
      icon: 'menu_book',
      label: 'Goodreads',
      href: opts.isbn
        ? `https://www.goodreads.com/search?q=${opts.isbn}`
        : `https://www.goodreads.com/search?q=${q}`,
    },
    {
      key: 'audible',
      icon: 'headphones',
      label: 'Audible',
      href: opts.asin
        ? `https://www.audible.com/pd/${opts.asin}`
        : `https://www.audible.com/search?keywords=${q}`,
    },
    {
      key: 'hardcover',
      icon: 'auto_stories',
      label: 'Hardcover',
      href: `https://hardcover.app/search?q=${q}`,
    },
  ]
}
