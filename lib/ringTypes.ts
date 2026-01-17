// Canonical ring event lifecycle as stored in the database
export const RING_EVENT_STATUSES = ['ringed', 'answered'] as const
export type RingEventStatus = (typeof RING_EVENT_STATUSES)[number]

// Receiver intent metadata (stored in response_type)
export const RESPONSE_TYPES = ['answered', 'busy', 'declined'] as const
export type ResponseType = (typeof RESPONSE_TYPES)[number]

// Helper
export const isTerminalStatus = (status: RingEventStatus) =>
  status === 'answered'
