import { describe, expect, it } from 'vitest'
import {
  buildAgentInventoryDetailsReply,
  isAgentInventoryDetailsRequest,
} from './inventory-reply'
import type { PropertyReachStats } from './inventory-digest'

const stats: PropertyReachStats[] = [
  {
    property_id: 'p1',
    title: 'BTM Commercial Building',
    directBuyers: 5,
    newDirectBuyers: 1,
    indirectBuyers: 1,
    newIndirectBuyers: 1,
    agentsReached: 2,
  },
]

describe('agent inventory detail replies', () => {
  it('recognises the digest quick reply only', () => {
    expect(isAgentInventoryDetailsRequest('Tell me more')).toBe(true)
    expect(isAgentInventoryDetailsRequest('  tell me more ')).toBe(true)
    expect(isAgentInventoryDetailsRequest('tell me more about this')).toBe(
      false
    )
  })

  it('names direct recipients and explains that a share is not buyer interest', () => {
    const message = buildAgentInventoryDetailsReply('Surendra', stats, [
      {
        propertyId: 'p1',
        propertyTitle: 'BTM Commercial Building',
        buyerName: 'Asnad',
        sharedAt: '2026-09-11T09:11:02.740Z',
      },
    ])

    expect(message).toContain('Hi Surendra')
    expect(message).toContain('*BTM Commercial Building*')
    expect(message).toContain(
      'Shared directly with *Asnad* on 11 Sept, 2:41 pm'
    )
    expect(message).toContain('1 new buyer through partner consultants')
    expect(message).toContain('does not yet mean they enquired')
    expect(message).not.toContain('no fresh activity')
  })
})
