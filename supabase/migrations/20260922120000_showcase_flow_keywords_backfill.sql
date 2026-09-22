-- Flows cloned from the Real Estate Showcase template carry its old entry
-- keywords in their own row. Move the ones still on a stock list; leave
-- any list someone edited alone.

UPDATE flows
SET trigger_config = jsonb_build_object(
      'keywords', jsonb_build_array(
        'hi', 'hello', 'hey', 'menu',
        'show properties', 'show me properties',
        'buy property', 'rent property',
        'looking to buy', 'looking to rent',
        'want to buy', 'want to rent'
      ),
      'match_type', 'contains'
    ),
    updated_at = now()
WHERE trigger_type = 'keyword'
  AND (
    (
      trigger_config->'keywords' @> '["hi","hello","invest","buy","rent","properties","homes","listing","show properties"]'::jsonb
      AND trigger_config->'keywords' <@ '["hi","hello","invest","buy","rent","properties","homes","listing","show properties"]'::jsonb
    )
    OR (
      trigger_config->'keywords' @> '["hello","hi","invest","buy","rent","properties","homes","listing"]'::jsonb
      AND trigger_config->'keywords' <@ '["hello","hi","invest","buy","rent","properties","homes","listing"]'::jsonb
    )
  );
