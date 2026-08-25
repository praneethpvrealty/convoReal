import { describe, expect, it } from 'vitest'
import {
  appointmentUpdateMessage,
  notificationRecipientIds,
} from './update-notification'

describe('appointment update notifications', () => {
  it('targets only newly added participants when requested', () => {
    expect(
      notificationRecipientIds({
        previousIds: ['a', 'b'],
        currentIds: ['b', 'c', 'c'],
        scope: 'new',
      }),
    ).toEqual(['c'])
  })

  it('targets every current participant without duplicates', () => {
    expect(
      notificationRecipientIds({
        previousIds: ['a'],
        currentIds: ['a', 'b', 'a'],
        scope: 'all',
      }),
    ).toEqual(['a', 'b'])
  })

  it('explains a new participant addition with the current event details', () => {
    const message = appointmentUpdateMessage({
      contactName: 'Ramanathan',
      accountName: 'Aryavarta Realty',
      isNewParticipant: true,
      appointment: {
        id: 'event-1',
        account_id: 'account-1',
        title: 'Property visit',
        start_time: '2026-08-26T05:20:00.000Z',
        location: 'JP Nagar',
      },
    })

    expect(message).toContain('You have been added to an event')
    expect(message).toContain('Event: Property visit')
    expect(message).toContain('Location: JP Nagar')
  })
})
