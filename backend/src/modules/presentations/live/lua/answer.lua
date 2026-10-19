-- openpoll:answer v1
--
-- One atomic step per accepted answer (W2-D). answer.service.ts grades the
-- payload in JS first (slide types own grading), then this script decides and
-- writes: window check, participant auth, rate limit, dedup, the type's Redis
-- ops, scores, the stored result and the coalescer's dirty mark. Nothing is
-- written unless the answer is accepted, so a rejection never needs a rollback.
--
-- KEYS (all in the session's hash-tag slot):
--   1 meta  2 slides  3 kicked  4 tokens  5 answered:{slide}  6 results:{slide}
--   7 scores  8 correct  9 rate:{participant}  10 dirty  11 dirty:slides
--   12 dist:{slide}  13 disp:{slide}  14 feed:{slide}
-- ARGV:
--   1 participantId  2 participantToken  3 slideId  4 slideIndex  5 startedAtMs
--   6 nowMs  7 ticketOk ('1'|'0')  8 score  9 isCorrect ('1'|'0')
--   10 stored result JSON  11 ops JSON (RedisOp[])  12 rateMax  13 rateWindowMs
--   14 dirtyWindowMs  15 ttlSec  16 graceMs  17 ticketGraceMs
--
-- Replies: {'OK', answeredCount, ownsDirtyWindow(0|1)}, {'DUP', storedJson,
-- answeredCount} or {REASON} with REASON one of CLOSED, NO_WINDOW, STALE,
-- NO_TOKEN, BAD_TOKEN, KICKED, RATE_LIMITED, TIME_UP, BAD_OP.

local pid = ARGV[1]
local slideId = ARGV[3]
local slideIndex = tonumber(ARGV[4])
local startedAt = tonumber(ARGV[5])
local now = tonumber(ARGV[6])
local ticketOk = ARGV[7] == '1'
local isCorrect = ARGV[9] == '1'

-- 1. The slide's answer window.
local rawWindow = redis.call('HGET', KEYS[2], slideId)
if not rawWindow then return {'NO_WINDOW'} end
local window = cjson.decode(rawWindow)
-- The client graded against another run of this slide (reopened meanwhile): reload and retry.
if window.slideIndex ~= slideIndex or window.startedAtMs ~= startedAt then return {'STALE'} end

-- 2. Who is answering. A missing token means the Redis mirror lacks the participant.
local storedToken = redis.call('HGET', KEYS[4], pid)
if not storedToken then return {'NO_TOKEN'} end
if storedToken ~= ARGV[2] then return {'BAD_TOKEN'} end
if redis.call('SISMEMBER', KEYS[3], pid) == 1 then return {'KICKED'} end

-- 3. Per-participant budget (counts every authenticated attempt, whatever the channel).
local attempts = redis.call('INCR', KEYS[9])
if attempts == 1 then redis.call('PEXPIRE', KEYS[9], tonumber(ARGV[13])) end
if attempts > tonumber(ARGV[12]) then return {'RATE_LIMITED'} end

-- 4. Already answered: hand back the stored result so the caller can tell a
--    replay (same clientAnswerId) from a second answer. Nothing is written.
if redis.call('SISMEMBER', KEYS[5], pid) == 1 then
  return {'DUP', redis.call('HGET', KEYS[6], pid) or '', redis.call('SCARD', KEYS[5])}
end

-- 5. Is the slide still taking answers? A session that ended takes none, not
--    even with a ticket. `open` goes false on close, reveal and leaving the
--    slide. A timed slide takes answers until its deadline plus grace; a valid
--    slide ticket stretches that grace.
if redis.call('HGET', KEYS[1], 'status') == 'ended' then return {'CLOSED'} end
if not window.open then return {'CLOSED'} end
local endsAt = window.endsAtMs
if endsAt ~= nil and endsAt ~= cjson.null then
  local grace = tonumber(ARGV[16])
  if ticketOk then grace = tonumber(ARGV[17]) end
  if now > endsAt + grace then return {'TIME_UP'} end
end

-- 6. Validate the type's ops before the first write.
local ops = cjson.decode(ARGV[11])
local targets = { dist = KEYS[12], disp = KEYS[13], feed = KEYS[14] }
for _, op in ipairs(ops) do
  if targets[op.key] == nil then return {'BAD_OP'} end
  if op.op ~= 'hincrby' and op.op ~= 'hsetnx' and op.op ~= 'lpush_trim' then return {'BAD_OP'} end
end

-- 7. Apply.
redis.call('SADD', KEYS[5], pid)
redis.call('ZINCRBY', KEYS[7], ARGV[8], pid)
if isCorrect then redis.call('HINCRBY', KEYS[8], pid, 1) end
local touched = { KEYS[5], KEYS[6], KEYS[7], KEYS[8] }
for _, op in ipairs(ops) do
  local key = targets[op.key]
  if op.op == 'hincrby' then
    redis.call('HINCRBY', key, op.field, op.by)
  elseif op.op == 'hsetnx' then
    redis.call('HSETNX', key, op.field, op.value)
  else
    redis.call('LPUSH', key, op.value)
    redis.call('LTRIM', key, 0, op.max - 1)
  end
  touched[#touched + 1] = key
end
redis.call('HSET', KEYS[6], pid, ARGV[10])
local ttl = tonumber(ARGV[15])
for _, key in ipairs(touched) do redis.call('EXPIRE', key, ttl) end

-- 8. Coalescer: mark the slide dirty; the answer that opens the 250ms window
--    owns the flush.
redis.call('SADD', KEYS[11], slideId)
redis.call('EXPIRE', KEYS[11], 60)
local opened = redis.call('SET', KEYS[10], '1', 'NX', 'PX', tonumber(ARGV[14]))
local owns = 0
if opened then owns = 1 end

return {'OK', redis.call('SCARD', KEYS[5]), owns}
