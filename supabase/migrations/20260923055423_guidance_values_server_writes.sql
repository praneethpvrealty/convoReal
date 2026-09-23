-- Saved guidance values are written only by POST /api/guidance-value/saved,
-- which recomputes the total from the stored rate and checks that the
-- property or deal belongs to the caller's account. A direct insert through
-- the member policy skipped both, so members lose it; the route writes with
-- the service role under explicit account scoping.
DROP POLICY IF EXISTS property_guidance_values_insert ON property_guidance_values;
