// The caps. Kept out of src/worker.ts: a Worker's entry module may export only handlers and classes.
// The account is on the Workers Free plan, which cannot be billed: past a free limit the call fails with an error
// (developers.cloudflare.com/durable-objects/platform/pricing, read 25 Oct 2026). These caps keep this app far inside
// those limits, because the account's other apps share them.

// ---- Qloo -------------------------------------------------------------------------------------------------------
// The hackathon key's own headers, read 25 Oct 2026: X-Month-RateLimit-Limit 50000 and X-Second-RateLimit-Limit 10, for
// every app on the key together. 500 a day is 1% of the month a day; over the 11 days to the end of judging it is at most
// 5,500 of the 49,542 left that morning (11%). Cached answers are free and not counted.
export const DAILY_QLOO_CALLS = 500
/** One build stops at this many Qloo calls: 4 rounds x 1 call, 2 for the generation round, up to 2 seed searches, and
 *  up to 2 replans x 2 rounds = 4 + 1 + 2 + 4 = 11, plus 5 spare. */
export const QLOO_CALLS_PER_BUILD = 16
/** Live Qloo stops while the key's month has fewer calls left than this (X-Month-RateLimit-Remaining on the last live
 *  answer). The month is 50,000 calls for three apps (resets about 21 Nov); the lead set the floor at 3,000, 6% of the
 *  month, so the other apps and judging keep calls. Cached answers and recorded builds still play. */
export const QLOO_MONTH_FLOOR = 3000
/** A reading older than this no longer stops live Qloo, so one call can read the month again after it resets. While
 *  the month stays low that is at most 4 calls a day per app. */
export const QLOO_QUOTA_READING_MS = 6 * 60 * 60 * 1000
/** The key allows 10 calls a second (X-Second-RateLimit-Limit) for every app on it. A build waits this long between its
 *  live calls: 1,000 / 110 = 9 a second at most. */
export const QLOO_CALL_GAP_MS = 110
/** 2 fresh builds x 16 calls = 32, plus 8 for the host's seed searches. */
export const DAILY_QLOO_CALLS_PER_VISITOR = 40
/** Fresh builds per visitor a day. A preset, a replay or a build already in the cache is free and not counted. */
export const DAILY_BUILDS_PER_VISITOR = 2

// ---- Workers AI (the shared ledger) -------------------------------------------------------------------------------
// The account's free 10,000 neurons a day is shared through the hackathon-ledger. Shares during judging (2 to 5 Nov):
// Circlekeeper 700, Dispute Desk 700, Job Done 2,000, Running Tab 1,500, Gift Scout 3,500, Right Pitch 450, Listing Lens
// 450, a total of 9,300; 200 more held back by the lead makes the account cap of 9,500, under the free 10,000.
// A build makes 2 model calls (plan, names) and up to 2 more (replans). Measured on the hosted app, 25 Oct 2026: six
// live builds cost 7.2 to 7.6 neurons each, so 450 is about 59 live builds a day. The ledger holds MAX_CALL_NEURONS
// before each call, so the share stops a build early, never late.
// Past the share, a build runs in template mode: Qloo still builds it, the round names come from the templates.
export const DAILY_NEURONS = 450
export const DEFAULT_ACCOUNT_NEURONS = 9500
// The room held in the ledger before each Workers AI call; the row then takes the call's real cost. Gift Scout measured
// the largest call on this model at 48.4 neurons (24 Oct 2026); 48.4 x 1.5 = 72.6, rounded up to 73.
export const MAX_CALL_NEURONS = 73

// ---- Rooms (Durable Objects, Workers Free plan, whole account) ----------------------------------------------------
// Free plan, read 25 Oct 2026: 100,000 requests a day (a WebSocket open is 1 request; incoming WebSocket messages count
// 20 to 1; outgoing messages are free; each alarm is 1), 13,000 GB-s of duration a day, 100,000 rows written a day.
export const ROOMS_PER_DAY = 60
export const ROOMS_PER_VISITOR_PER_DAY = 3
export const PLAYERS_PER_ROOM = 40
/** Socket opens per room, counting reconnects: 40 players x 3. */
export const SOCKET_OPENS_PER_ROOM = 120
/** Messages one socket may send before the room closes it: 20 answers need 20; the rest is room for a retry. */
export const PLAYER_MESSAGES_PER_SOCKET = 60
/** The host sends start, then next twice a question (reveal, then the next one): 1 + 2 x 20 + end = 42. */
export const HOST_MESSAGES_PER_SOCKET = 200
// Requests in the worst room: 120 opens + (40 x 60 + 200) / 20 messages + 21 alarms + 1 set up = 120 + 130 + 22 = 272.
// 60 rooms x 272 = 16,320 a day, 16% of the account's free 100,000.
// Rows written: the room writes its state once when a question opens and once when it is revealed (2 x 20 = 40), once
// per join (40), and once to set up and once to delete: about 82 rows a room. 60 x 82 = 4,920, 5% of the free 100,000.
// Answers ride on each socket's attachment until the reveal, so they write no rows.
// Duration: hibernating sockets cost nothing while quiet. If each wake ran a full second (they take milliseconds):
// (2,600 messages + 21 alarms) x 1 s x 0.128 GB = 336 GB-s a room; 60 rooms = 20,160 GB-s is over 13,000, so the room
// never sleeps in code (no setTimeout): timers are alarms. At 50 ms a wake it is 1,008 GB-s a day, 8% of 13,000.
export const QUESTIONS_PER_ROUND = 5
/** Years between the right answer and the next one on a "which came first" question: one year apart is a coin toss
 * for a room (the first live build, 25 Oct, asked 2018 against 2019 five times). */
export const YEAR_MARGIN = 3
/** Items scored under each age lens in the generation round (2 calls); about half clear the 0.15 gap (kill test). */
export const LENS_ITEMS = 20
export const QUESTION_SECONDS = 20
/** A room and everything in it is deleted this long after it is made. */
export const ROOM_HOURS = 24
export const NICKNAME_MAX = 16

/** The pause between events of a cached or recorded build, so the log reads as it was built. */
export const REPLAY_PACE_MS = 120
