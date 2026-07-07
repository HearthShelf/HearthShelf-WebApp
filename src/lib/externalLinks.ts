/**
 * Deep links to external book sites, built from real ISBN/ASIN metadata when
 * present, with a title+author search fallback. Which providers appear is a
 * per-user choice (Settings -> Library), each defaulting to on.
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
  enabled: { goodreads: boolean; audible: boolean; hardcover: boolean }
}): ExternalLink[] {
  const q = encodeURIComponent(`${opts.title ?? ''} ${opts.author ?? ''}`.trim())
  const links: ExternalLink[] = []
  if (opts.enabled.goodreads) {
    links.push({
      key: 'goodreads',
      icon: 'menu_book',
      label: 'Goodreads',
      href: opts.isbn
        ? `https://www.goodreads.com/search?q=${opts.isbn}`
        : `https://www.goodreads.com/search?q=${q}`,
    })
  }
  if (opts.enabled.audible) {
    links.push({
      key: 'audible',
      icon: 'headphones',
      label: 'Audible',
      href: opts.asin
        ? `https://www.audible.com/pd/${opts.asin}`
        : `https://www.audible.com/search?keywords=${q}`,
    })
  }
  if (opts.enabled.hardcover) {
    links.push({
      key: 'hardcover',
      icon: 'auto_stories',
      label: 'Hardcover',
      href: `https://hardcover.app/search?q=${q}`,
    })
  }
  return links
}
