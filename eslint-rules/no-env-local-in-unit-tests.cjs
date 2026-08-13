/**
 * Flags a unit test that reads `.env.local`.
 *
 * `src/lib/ai/gemini.test.ts` used to parse `.env.local` at import time
 * and copy every variable in it into `process.env`, then prefer a real
 * `GEMINI_API_KEY` over its own mock. Three things followed:
 *
 *   1. The developer's live service-role key, encryption key and app
 *      secret were loaded into the unit-test process, overwriting the
 *      deliberate dummies in vitest.config.ts for every file sharing
 *      that worker.
 *   2. Tests that reached unmocked provider code billed a real account
 *      and passed, instead of failing on a bogus credential. The
 *      calendar suite was doing exactly this — it ran five times slower
 *      because of the round trips.
 *   3. The suite behaved differently depending on who ran it. CI has no
 *      keys, so a test could pass locally and fail on main, or vice
 *      versa, for reasons no diff explained.
 *
 * Unit tests get their secrets from `vitest.config.ts`, which is the one
 * place they are declared and is checked in. Integration tests are
 * exempt: hitting the real Supabase project with real credentials is
 * their whole purpose, and `npm test` never runs them.
 */

const ENV_LOCAL = /\.env\.local/;

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow reading .env.local from a unit test; secrets come from vitest.config.ts',
    },
    schema: [],
    messages: {
      envLocal:
        'Unit tests must not read .env.local — it loads real secrets into the test process and makes the suite depend on who runs it. Add the variable to `test.env` in vitest.config.ts instead. (Integration tests are exempt.)',
    },
  },

  create(context) {
    const report = (node) => context.report({ node, messageId: 'envLocal' });
    return {
      Literal(node) {
        if (typeof node.value === 'string' && ENV_LOCAL.test(node.value)) report(node);
      },
      TemplateElement(node) {
        const raw = node.value && node.value.cooked;
        if (typeof raw === 'string' && ENV_LOCAL.test(raw)) report(node);
      },
    };
  },
};
