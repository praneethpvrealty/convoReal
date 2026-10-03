/**
 * Flags any read of `process.env.SUPABASE_SERVICE_ROLE_KEY` outside
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
 * Scripts under `src/scripts/` run outside Next.js with their own env
 * loading, so they keep constructing clients directly.
 */

const KEY = 'SUPABASE_SERVICE_ROLE_KEY';

function isProcessEnv(node) {
  return (
    node.type === 'MemberExpression' &&
    node.object.type === 'Identifier' &&
    node.object.name === 'process' &&
    ((node.property.type === 'Identifier' && node.property.name === 'env') ||
      (node.property.type === 'Literal' && node.property.value === 'env'))
  );
}

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
    return {
      MemberExpression(node) {
        if (!isProcessEnv(node.object)) return;
        const name =
          node.property.type === 'Identifier' && !node.computed
            ? node.property.name
            : node.property.type === 'Literal'
              ? node.property.value
              : null;
        if (name !== KEY) return;
        context.report({ node, messageId: 'inline', data: { key: KEY } });
      },
    };
  },
};
