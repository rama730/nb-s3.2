-- ============================================================================
-- DM PAIRS: enforce single DM conversation per user pair (1M+ reliability)
-- This prevents duplicate DMs and enables O(1) lookup for get-or-create.
-- ============================================================================

CREATE TABLE IF NOT EXISTS dm_pairs (
  user_low UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  user_high UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT dm_pairs_user_low_high_unique UNIQUE (user_low, user_high),
  CONSTRAINT dm_pairs_conversation_unique UNIQUE (conversation_id),
  CONSTRAINT dm_pairs_distinct_users CHECK (user_low <> user_high)
);

-- Supporting indexes for lookups (planner-friendly at scale)
CREATE INDEX IF NOT EXISTS dm_pairs_user_low_idx ON dm_pairs(user_low);
CREATE INDEX IF NOT EXISTS dm_pairs_user_high_idx ON dm_pairs(user_high);

-- Lock down from client access (server/service role can still read/write)
ALTER TABLE dm_pairs ENABLE ROW LEVEL SECURITY;

