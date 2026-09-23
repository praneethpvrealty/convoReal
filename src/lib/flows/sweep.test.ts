import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>

const h = vi.hoisted(() => ({
  runs: [] as Record<string, unknown>[],
  events: [] as Record<string, unknown>[],
  lease: 'run' as 'run' | 'busy' | 'lookup_failed',
  leased: [] as string[],
  beforeRun: null as (() => void) | null,
}))

vi.mock('@/lib/conversations/outbound-lease', () => ({
  withContactConversationLease: async (
    _db: unknown,
    _accountId: string,
    contactId: string,
    run: () => Promise<unknown>,
  ) => {
    h.leased.push(contactId)
    if (h.lease !== 'run') return { status: h.lease }
    h.beforeRun?.()
    return { status: 'ran', value: await run() }
  },
}))

import { sweepStaleFlowRuns } from './sweep'

const HOUR = 60 * 60 * 1000
const STALE_AT = new Date(Date.now() - 30 * HOUR).toISOString()

function fakeAdmin() {
  return {
    from: (table: string) => {
      const filters: Record<string, unknown> = {}
      let patch: Row | null = null
      const matching = () =>
        h.runs.filter((r) =>
          Object.entries(filters).every(([k, v]) => r[k] === v),
        )
      const chain: Record<string, unknown> = {
        select: () => chain,
        update: (values: Row) => {
          patch = values
          return chain
        },
        insert: async (row: Row) => {
          h.events.push(row)
          return { error: null }
        },
        eq: (column: string, value: unknown) => {
          filters[column] = value
          return chain
        },
        then: (resolve: (v: unknown) => unknown) => {
          if (table !== 'flow_runs') {
            return Promise.resolve({ data: null, error: null }).then(resolve)
          }
          const rows = matching()
          if (patch) {
            for (const r of rows) Object.assign(r, patch)
            return Promise.resolve({
              data: rows.map((r) => ({ id: r.id })),
              error: null,
            }).then(resolve)
          }
          return Promise.resolve({
            data: rows.map((r) => ({
              ...r,
              flows: { fallback_policy: { on_timeout_hours: 24 } },
            })),
            error: null,
          }).then(resolve)
        },
      }
      return chain
    },
  }
}

function addRun(overrides: Row = {}) {
  const run = {
    id: 'run-1',
    account_id: 'acct-1',
    contact_id: 'contact-1',
    status: 'active',
    last_advanced_at: STALE_AT,
    ...overrides,
  }
  h.runs.push(run)
  return run
}

beforeEach(() => {
  h.runs = []
  h.events = []
  h.lease = 'run'
  h.leased = []
  h.beforeRun = null
})

describe('sweepStaleFlowRuns', () => {
  it('[INB-019] times out a stale run under its contact conversation lease', async () => {
    addRun()

    const result = await sweepStaleFlowRuns(fakeAdmin() as never)

    expect(result).toEqual({ swept: 1, deferred: 0 })
    expect(h.leased).toEqual(['contact-1'])
    expect(h.runs[0]).toMatchObject({
      status: 'timed_out',
      end_reason: 'stale_sweep',
    })
    expect(h.events).toEqual([
      expect.objectContaining({ flow_run_id: 'run-1', event_type: 'timeout' }),
    ])
  })

  it('[INB-019] leaves a run alone while an inbound chain holds its conversation', async () => {
    h.lease = 'busy'
    addRun()

    const result = await sweepStaleFlowRuns(fakeAdmin() as never)

    expect(result).toEqual({ swept: 0, deferred: 1 })
    expect(h.runs[0].status).toBe('active')
    expect(h.events).toEqual([])
  })

  it('[INB-019] a failed conversation lookup leaves the run for the next sweep', async () => {
    h.lease = 'lookup_failed'
    addRun()

    const result = await sweepStaleFlowRuns(fakeAdmin() as never)

    expect(result).toEqual({ swept: 0, deferred: 1 })
    expect(h.runs[0].status).toBe('active')
  })

  it('[INB-019] a run the customer advanced after the scan is not timed out', async () => {
    addRun()
    h.beforeRun = () => {
      h.runs[0].last_advanced_at = new Date().toISOString()
    }

    const result = await sweepStaleFlowRuns(fakeAdmin() as never)

    expect(result).toEqual({ swept: 0, deferred: 0 })
    expect(h.runs[0].status).toBe('active')
    expect(h.events).toEqual([])
  })

  it('[INB-019] a run with no contact is timed out without a lease', async () => {
    addRun({ contact_id: null })

    const result = await sweepStaleFlowRuns(fakeAdmin() as never)

    expect(result).toEqual({ swept: 1, deferred: 0 })
    expect(h.leased).toEqual([])
  })

  it('[INB-019] a run inside its timeout is never leased or touched', async () => {
    addRun({ last_advanced_at: new Date(Date.now() - HOUR).toISOString() })

    const result = await sweepStaleFlowRuns(fakeAdmin() as never)

    expect(result).toEqual({ swept: 0, deferred: 0 })
    expect(h.leased).toEqual([])
    expect(h.runs[0].status).toBe('active')
  })
})
