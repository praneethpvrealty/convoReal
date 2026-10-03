/**
 * Flags any read of `SUPABASE_SERVICE_ROLE_KEY` outside
 * `src/lib/supabase/admin.ts` and `src/scripts/`.
 *
 * Every server module that needs to bypass RLS gets its client from
 * `supabaseAdmin()`. Before this rule, five modules each exported their
 * own singleton under a different name (`billingAdmin`, `getAdminClient`,
 * `denAdmin`, …) and eighteen more built a throwaway client inline with
 * `!` assertions, so a missing key surfaced as an opaque supabase-js
 * failure rather than as the configuration error it is, and a test had
 * to know which of six module paths to mock. One factory, one mock path.
 *
 * The key is matched by name wherever it can be read from, so
 * `process.env.SUPABASE_SERVICE_ROLE_KEY`, `process.env['…']`,
 * `const { SUPABASE_SERVICE_ROLE_KEY } = process.env` and a read through
 * an alias of `process.env` are all reported.
 *
 * Scripts under `src/scripts/` run outside Next.js with their own env
 * loading, so they keep constructing clients directly.
 */

const KEY = 'SUPABASE_SERVICE_ROLE_KEY';

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Construct the service-role Supabase client with supabaseAdmin() from @/lib/supabase/admin',
    },
    schema: [],
    messages: {
      inline:
        "Do not read {{key}} here. Call supabaseAdmin() from '@/lib/supabase/admin' instead of building a service-role client inline.",
    },
  },
  create(context) {
    const report = (node) =>
      context.report({ node, messageId: 'inline', data: { key: KEY } });
    return {
      MemberExpression(node) {
        if (node.computed) {
          if (node.property.type === 'Literal' && node.property.value === KEY) {
            report(node);
          }
          return;
        }
        if (node.property.type === 'Identifier' && node.property.name === KEY) {
          report(node);
        }
      },
      Property(node) {
        if (node.parent.type !== 'ObjectPattern') return;
        const key = node.key;
        if (
          (key.type === 'Identifier' && !node.computed && key.name === KEY) ||
          (key.type === 'Literal' && key.value === KEY)
        ) {
          report(node);
        }
      },
    };
  },
};
