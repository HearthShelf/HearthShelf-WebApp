/**
 * The MCP server itself - the tool surface an AI client sees.
 *
 * DESIGN RULE: every tool returns FACTS, never opinions, and this Worker never
 * calls an LLM. "Does this book fit me?" is answered by the CLIENT's model
 * reasoning over `get_reading_history` + `find_similar` + `get_recommendations`.
 * That is what makes this cheap: the user's own AI subscription pays for all
 * inference, and we ship JSON. Adding an AI API call here would re-introduce
 * exactly the cost this feature exists to avoid.
 *
 * DESIGN RULE 2: read-only. There is no tool here that can mutate a library, and
 * there is no write scope to request. Book metadata is untrusted text that flows
 * into a model's context, so a prompt-injected model must not be able to reach
 * anything destructive. Keep it that way.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { McpAgent } from 'agents/mcp'
import { z } from 'zod'
import type { Env, McpProps } from './types'
import { AbsSession } from './lib/absClient'
import { listServers, CpAuthError, CpError } from './lib/controlPlane'
import {
  searchLibrary,
  getLibraries,
  getItem,
  getInProgress,
  getFinished,
  getListeningStats,
  getRecommendations,
  findSimilar,
} from './tools/library'
import { listDebugSeries, getSeriesReport, getQueueReport } from './tools/debug'

/** Wrap a tool body so failures read as guidance, not as raw HTTP noise. */
async function safe<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof CpAuthError) {
      return {
        error:
          'Your HearthShelf connection has expired. Reconnect the HearthShelf ' +
          'connector in your AI client settings to continue.',
      }
    }
    if (err instanceof CpError) {
      return { error: `Could not reach your HearthShelf server: ${err.message}` }
    }
    return { error: `Something went wrong: ${(err as Error).message}` }
  }
}

/** Render a tool result as MCP content. */
function json(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] }
}

export class HearthShelfMCP extends McpAgent<Env, never, McpProps> {
  server = new McpServer({
    name: 'HearthShelf',
    version: '0.1.0',
  })

  /** Lazily-built ABS session bound to this grant's identity. */
  private session?: AbsSession

  /**
   * The grant props. OAuthProvider always populates these before a tool runs -
   * /mcp is token-gated, so an unauthenticated request never reaches here - but
   * the base class types them as optional, so fail loudly rather than casting.
   */
  private identity(): McpProps {
    if (!this.props) throw new CpAuthError('no_grant_context')
    return this.props
  }

  private abs(): AbsSession {
    if (!this.session) this.session = new AbsSession(this.env, this.identity())
    return this.session
  }

  /**
   * Resolve the server to act on. Most users have exactly one linked box, so
   * `server_id` is optional everywhere and defaults to the only one - this keeps
   * the common case single-argument while staying correct for multi-server users.
   */
  private async resolveServerId(explicit?: string): Promise<string> {
    if (explicit) return explicit
    const servers = await listServers(this.env, this.identity())
    if (servers.length === 0) {
      throw new CpError('no_servers_linked: link a server at app.hearthshelf.com first')
    }
    if (servers.length > 1) {
      const names = servers.map((s) => `${s.name} (${s.id})`).join(', ')
      throw new CpError(`multiple servers linked - pass server_id. Available: ${names}`)
    }
    return servers[0].id
  }

  async init() {
    const serverIdArg = {
      server_id: z
        .string()
        .optional()
        .describe('Which linked server to query. Omit if you only have one.'),
    }

    this.server.registerTool(
      'list_servers',
      {
        description:
          'List the HearthShelf/AudiobookShelf servers this user has linked. ' +
          'Call this first if a later tool reports that multiple servers exist.',
        inputSchema: {},
      },
      async () => json(await safe(async () => listServers(this.env, this.identity()))),
    )

    this.server.registerTool(
      'list_libraries',
      {
        description:
          'List the libraries on a server (e.g. "Audiobooks", "Podcasts"), with ' +
          'their ids and media types. Useful before a scoped search.',
        inputSchema: { ...serverIdArg },
      },
      async ({ server_id }) =>
        json(
          await safe(async () => {
            const id = await this.resolveServerId(server_id)
            return getLibraries(this.abs(), id)
          }),
        ),
    )

    this.server.registerTool(
      'search_library',
      {
        description:
          "Search the user's own library by title, author or narrator. Use this to " +
          'check whether they already own a book, or to locate a book before asking ' +
          'for its details.',
        inputSchema: {
          query: z.string().min(1).describe('Title, author or narrator to search for.'),
          library_id: z
            .string()
            .optional()
            .describe('Restrict to one library. Omit to search all of them.'),
          limit: z.number().int().min(1).max(50).default(12),
          ...serverIdArg,
        },
      },
      async ({ query, library_id, limit, server_id }) =>
        json(
          await safe(async () => {
            const id = await this.resolveServerId(server_id)
            return searchLibrary(this.abs(), id, query, library_id, limit)
          }),
        ),
    )

    this.server.registerTool(
      'get_book',
      {
        description:
          'Full details for one library item: description, series, genres, narrator, ' +
          "duration, publish year, and the user's own progress and rating.",
        inputSchema: {
          item_id: z.string().describe('Library item id, from search_library.'),
          ...serverIdArg,
        },
      },
      async ({ item_id, server_id }) =>
        json(
          await safe(async () => {
            const id = await this.resolveServerId(server_id)
            return getItem(this.abs(), id, item_id)
          }),
        ),
    )

    this.server.registerTool(
      'get_reading_history',
      {
        description:
          'Books the user has FINISHED, newest first, with ratings where they gave ' +
          'one. This is the single best signal for judging whether a new book fits ' +
          'their taste - prefer it over guessing from the library contents, which ' +
          'includes plenty they never read.',
        inputSchema: {
          limit: z.number().int().min(1).max(100).default(30),
          ...serverIdArg,
        },
      },
      async ({ limit, server_id }) =>
        json(
          await safe(async () => {
            const id = await this.resolveServerId(server_id)
            return getFinished(this.abs(), id, limit)
          }),
        ),
    )

    this.server.registerTool(
      'get_in_progress',
      {
        description:
          'What the user is currently reading or listening to, with percent complete. ' +
          'Good for "what should I finish next?" and for avoiding recommendations ' +
          'they are already partway through.',
        inputSchema: { ...serverIdArg },
      },
      async ({ server_id }) =>
        json(
          await safe(async () => {
            const id = await this.resolveServerId(server_id)
            return getInProgress(this.abs(), id)
          }),
        ),
    )

    this.server.registerTool(
      'get_listening_stats',
      {
        description:
          'Listening totals and recent activity: time listened, books finished, ' +
          'and per-day totals. Use for habit questions ("am I reading more this ' +
          'year?"), not for taste questions.',
        inputSchema: { ...serverIdArg },
      },
      async ({ server_id }) =>
        json(
          await safe(async () => {
            const id = await this.resolveServerId(server_id)
            return getListeningStats(this.abs(), id)
          }),
        ),
    )

    this.server.registerTool(
      'get_recommendations',
      {
        description:
          "HearthShelf's own Discover picks for this user - personalised shelves " +
          'computed on their server from their history. Treat these as candidates ' +
          'to reason about and explain, not as a final answer.',
        inputSchema: { ...serverIdArg },
      },
      async ({ server_id }) =>
        json(
          await safe(async () => {
            const id = await this.resolveServerId(server_id)
            return getRecommendations(this.abs(), id)
          }),
        ),
    )

    this.server.registerTool(
      'find_similar',
      {
        description:
          "Find books IN THE USER'S LIBRARY similar to a given item, by shared " +
          'author, narrator, series or genre. Use this to answer "if I liked X, ' +
          'what else do I already own?" before suggesting anything they must buy.',
        inputSchema: {
          item_id: z.string().describe('Library item id to find neighbours for.'),
          limit: z.number().int().min(1).max(30).default(10),
          ...serverIdArg,
        },
      },
      async ({ item_id, limit, server_id }) =>
        json(
          await safe(async () => {
            const id = await this.resolveServerId(server_id)
            return findSimilar(this.abs(), id, item_id, limit)
          }),
        ),
    )

    // --- Admin diagnostics ---------------------------------------------------
    // Read-only, and gated by the connected server (its /hs/admin/* routes 403 a
    // non-admin token). Unlike everything above, these read server-wide data
    // rather than the caller's own library, so a non-admin simply cannot use
    // them. The UI's re-sweep write is deliberately NOT exposed - see
    // tools/debug.ts and DESIGN RULE 2 at the top of this file.

    this.server.registerTool(
      'list_debug_series',
      {
        description:
          'ADMIN ONLY. List the series in the library, to find the series_id that ' +
          'debug_series needs. Pass `query` to narrow by name - the full list is ' +
          'capped at 100 entries.',
        inputSchema: {
          query: z.string().optional().describe('Filter series by name substring.'),
          ...serverIdArg,
        },
      },
      async ({ query, server_id }) =>
        json(
          await safe(async () => {
            const id = await this.resolveServerId(server_id)
            return listDebugSeries(this.abs(), id, query)
          }),
        ),
    )

    this.server.registerTool(
      'debug_series',
      {
        description:
          'ADMIN ONLY. Explain why a series shows the books it shows. Returns the ' +
          'whole matching pipeline as facts: which Audible series the name resolved ' +
          'to and what else was in the running; every raw roster entry and whether ' +
          'filtering dropped it as a placeholder or a duplicate edition; and for ' +
          'each remaining book whether the library owns it, which signal decided ' +
          '(asin/title/sequence) and the reason every other signal was refused. ' +
          'Use it when a book is wrongly listed as missing, or a missing book never ' +
          'appears. The `normalizedTitle` field is the string matching actually ' +
          'compares - when it reads as the series name plus a number instead of the ' +
          "book's own name, the series-prefix strip is what failed.",
        inputSchema: {
          series_id: z.string().describe('ABS series id, from list_debug_series.'),
          ...serverIdArg,
        },
      },
      async ({ series_id, server_id }) =>
        json(
          await safe(async () => {
            const id = await this.resolveServerId(server_id)
            return getSeriesReport(this.abs(), id, series_id)
          }),
        ),
    )

    this.server.registerTool(
      'debug_queue',
      {
        description:
          "ADMIN ONLY. Explain a user's Auto Queue: every rule that ran, in priority " +
          'order, and for each book whether it was added, skipped as a duplicate, or ' +
          'excluded - with the reason. Also reports whether the stored queue still ' +
          'matches a fresh compute. Pass `item_id` to focus on one book and get the ' +
          'full per-rule verdict for it.',
        inputSchema: {
          user_id: z.string().describe('The ABS user id whose queue to explain.'),
          item_id: z.string().optional().describe('Library item id to inspect in detail.'),
          ...serverIdArg,
        },
      },
      async ({ user_id, item_id, server_id }) =>
        json(
          await safe(async () => {
            const id = await this.resolveServerId(server_id)
            return getQueueReport(this.abs(), id, user_id, item_id)
          }),
        ),
    )
  }
}
