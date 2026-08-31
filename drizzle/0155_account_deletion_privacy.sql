-- Confirmation tokens were generated but never consumed. Remove the dead
-- lookup and erase the plaintext secret from every lifecycle state.
UPDATE public.account_deletions
SET confirmation_token = NULL,
    token_expires_at = NULL
WHERE confirmation_token IS NOT NULL OR token_expires_at IS NOT NULL;

DROP INDEX IF EXISTS public.account_deletions_token_idx;

-- Completed audit rows retain operational proof without retaining the former
-- user's identity, free-text reason, or request metadata indefinitely.
UPDATE public.account_deletions
SET user_id = id,
    email = 'deleted-account@invalid',
    username = NULL,
    reason = NULL,
    metadata = '{}'::jsonb,
    cleanup_details = jsonb_build_object(
      'anonymized', true,
      'anonymizedAt', now()
    )
WHERE completed_at IS NOT NULL
  AND (
    user_id IS DISTINCT FROM id
    OR email IS DISTINCT FROM 'deleted-account@invalid'
    OR username IS NOT NULL
    OR reason IS NOT NULL
    OR metadata <> '{}'::jsonb
  );
