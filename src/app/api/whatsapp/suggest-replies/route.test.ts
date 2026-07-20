import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks ──────────────────────────────────────────────────────────
// getCurrentAccount → a ctx with a fake, chainable supabase whose two
// queries (conversation lookup, then recent messages) resolve to values
// the test controls.
let conversationResult: { data: unknown; error: unknown } = {
  data: { id: 'conv-1', contact: { name: 'Vinayak' } },
  error: null,
}
let messagesResult: { data: unknown; error: unknown } = {
  data: [
    { sender_type: 'customer', content_type: 'text', content_text: '3 cr to 4 cr max', created_at: '2026-07-20T06:00:00Z' },
    { sender_type: 'agent', content_type: 'text', content_text: 'Noted, sharing options', created_at: '2026-07-20T06:01:00Z' },
  ],
  error: null,
}

function makeSupabase() {
  return {
    from: vi.fn((table: string) => {
      const builder: Record<string, unknown> = {
        select: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        order: vi.fn(() => builder),
        maybeSingle: vi.fn(() => Promise.resolve(conversationResult)),
        limit: vi.fn(() => Promise.resolve(messagesResult)),
      }
      void table
      return builder
    }),
  }
}

let getCurrentAccountImpl: () => Promise<unknown> = async () => ({
  supabase: makeSupabase(),
  userId: 'user-1',
  accountId: 'acc-1',
})

vi.mock('@/lib/auth/account', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth/account')>('@/lib/auth/account')
  return { ...actual, getCurrentAccount: () => getCurrentAccountImpl() }
})

let generateJsonReturn = '["Sure, noted 3-4 Cr.", "Any preferred location?", "I will share shortlisted options shortly."]'
const generateJsonMock = vi.fn(async () => generateJsonReturn)
vi.mock('@/lib/ai/gemini', () => ({
  generateJson: (...args: unknown[]) => generateJsonMock(...(args as [])),
}))

const { POST } = await import('./route')

function post(body: unknown) {
  return new Request('http://localhost/api/whatsapp/suggest-replies', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('POST /api/whatsapp/suggest-replies', () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = 'test-key'
    conversationResult = { data: { id: 'conv-1', contact: { name: 'Vinayak' } }, error: null }
    messagesResult = {
      data: [
        { sender_type: 'customer', content_type: 'text', content_text: '3 cr to 4 cr max', created_at: '2026-07-20T06:00:00Z' },
      ],
      error: null,
    }
    generateJsonReturn = '["Sure, noted 3-4 Cr.", "Any preferred location?", "I will share options shortly."]'
    generateJsonMock.mockClear()
    getCurrentAccountImpl = async () => ({ supabase: makeSupabase(), userId: 'user-1', accountId: 'acc-1' })
  })

  it('returns parsed suggestions from the model', async () => {
    const res = await POST(post({ conversation_id: 'conv-1' }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { suggestions: string[] }
    expect(body.suggestions).toEqual([
      'Sure, noted 3-4 Cr.',
      'Any preferred location?',
      'I will share options shortly.',
    ])
    expect(generateJsonMock).toHaveBeenCalledOnce()
  })

  it('400s when conversation_id is missing', async () => {
    const res = await POST(post({}))
    expect(res.status).toBe(400)
    expect(generateJsonMock).not.toHaveBeenCalled()
  })

  it('404s when the conversation is not in the account', async () => {
    conversationResult = { data: null, error: null }
    const res = await POST(post({ conversation_id: 'nope' }))
    expect(res.status).toBe(404)
    expect(generateJsonMock).not.toHaveBeenCalled()
  })

  it('returns empty suggestions (no model call) when GEMINI_API_KEY is absent', async () => {
    delete process.env.GEMINI_API_KEY
    const res = await POST(post({ conversation_id: 'conv-1' }))
    const body = (await res.json()) as { suggestions: string[] }
    expect(body.suggestions).toEqual([])
    expect(generateJsonMock).not.toHaveBeenCalled()
  })

  it('returns empty suggestions when there is no text transcript to reply to', async () => {
    messagesResult = {
      data: [{ sender_type: 'customer', content_type: 'image', content_text: null, created_at: '2026-07-20T06:00:00Z' }],
      error: null,
    }
    const res = await POST(post({ conversation_id: 'conv-1' }))
    const body = (await res.json()) as { suggestions: string[] }
    expect(body.suggestions).toEqual([])
    expect(generateJsonMock).not.toHaveBeenCalled()
  })

  it('tolerates ```json fences and caps at 3 suggestions', async () => {
    generateJsonReturn = '```json\n["a", "b", "c", "d"]\n```'
    const res = await POST(post({ conversation_id: 'conv-1' }))
    const body = (await res.json()) as { suggestions: string[] }
    expect(body.suggestions).toEqual(['a', 'b', 'c'])
  })

  it('drops non-string and blank entries', async () => {
    generateJsonReturn = '["real reply", "", 42, "  another  "]'
    const res = await POST(post({ conversation_id: 'conv-1' }))
    const body = (await res.json()) as { suggestions: string[] }
    expect(body.suggestions).toEqual(['real reply', 'another'])
  })

  it('returns empty suggestions when the model output is not valid JSON', async () => {
    generateJsonReturn = 'Sorry, I could not help with that.'
    const res = await POST(post({ conversation_id: 'conv-1' }))
    const body = (await res.json()) as { suggestions: string[] }
    expect(body.suggestions).toEqual([])
  })
})
