import { describe, it, expect } from 'vitest'
import {
  hasReachUpdates,
  reachTotals,
  buildAgentReachSummaryLine,
  buildAgentInventoryDigestMessage,
  buildSignupInviteLine,
  buildDashboardPointerLine,
  type AgentInventoryDigest,
  type PropertyReachStats,
} from './inventory-digest'

function stats(overrides: Partial<PropertyReachStats> = {}): PropertyReachStats {
  return {
    property_id: 'p1',
    title: 'Sunrise Villa',
    directBuyers: 0,
    newDirectBuyers: 0,
    indirectBuyers: 0,
    newIndirectBuyers: 0,
    agentsReached: 0,
    ...overrides,
  }
}

function digest(properties: PropertyReachStats[], name: string | null = 'Deepak Sharma'): AgentInventoryDigest {
  return { contactId: 'c1', name, properties }
}

describe('hasReachUpdates', () => {
  it('is false when nothing new happened in the period', () => {
    expect(hasReachUpdates(digest([stats({ directBuyers: 5, indirectBuyers: 2 })]))).toBe(false)
  })

  it('is true when the period added a direct or indirect buyer', () => {
    expect(hasReachUpdates(digest([stats({ newDirectBuyers: 1 })]))).toBe(true)
    expect(hasReachUpdates(digest([stats({ newIndirectBuyers: 1 })]))).toBe(true)
  })
})

describe('reachTotals / buildAgentReachSummaryLine', () => {
  const d = digest([
    stats({ property_id: 'p1', directBuyers: 2, newDirectBuyers: 2, agentsReached: 1 }),
    stats({ property_id: 'p2', directBuyers: 1, indirectBuyers: 1, newIndirectBuyers: 1 }),
  ])

  it('sums across properties', () => {
    expect(reachTotals(d)).toEqual({
      directBuyers: 3,
      newDirectBuyers: 2,
      indirectBuyers: 1,
      newIndirectBuyers: 1,
      agentsReached: 1,
    })
  })

  it('mentions new buyers and cumulative reach in one line', () => {
    const line = buildAgentReachSummaryLine(d)
    expect(line).toContain('2 new direct buyers')
    expect(line).toContain('1 new buyer via partner agents')
    expect(line).toContain('3 direct / 1 indirect buyers so far')
    expect(line).not.toMatch(/\n/)
  })

  it('still reports cumulative totals when nothing is new', () => {
    const line = buildAgentReachSummaryLine(
      digest([stats({ directBuyers: 4, indirectBuyers: 2 })])
    )
    expect(line).toBe('4 direct / 2 indirect buyers so far')
  })
})

describe('buildAgentInventoryDigestMessage', () => {
  it('greets by first name and breaks down each active property', () => {
    const msg = buildAgentInventoryDigestMessage(
      digest([
        stats({ property_id: 'p1', title: 'Sunrise Villa', directBuyers: 2, newDirectBuyers: 1 }),
        stats({
          property_id: 'p2',
          title: 'Lake View Plot',
          indirectBuyers: 3,
          newIndirectBuyers: 2,
          agentsReached: 2,
        }),
      ]),
      'today',
      buildSignupInviteLine('https://www.convoreal.com')
    )
    expect(msg).toContain('Hi Deepak')
    expect(msg).toContain('*Sunrise Villa*')
    expect(msg).toContain('2 direct buyers (1 new)')
    expect(msg).toContain('*Lake View Plot*')
    expect(msg).toContain('3 buyers via partner agents (2 new)')
    expect(msg).toContain('shared with 2 partner agents')
    expect(msg).toContain('https://www.convoreal.com/signup')
    expect(msg).toContain('STOP UPDATES')
  })

  it('skips properties with no reach and falls back on the greeting', () => {
    const msg = buildAgentInventoryDigestMessage(
      digest(
        [
          stats({ property_id: 'p1', title: 'Silent Listing' }),
          stats({ property_id: 'p2', title: 'Active Listing', directBuyers: 1 }),
        ],
        null
      ),
      'this week',
      buildDashboardPointerLine('https://www.convoreal.com')
    )
    expect(msg).toContain('Hi there')
    expect(msg).not.toContain('Silent Listing')
    expect(msg).toContain('Active Listing')
    expect(msg).toContain('/dashboard')
  })
})
