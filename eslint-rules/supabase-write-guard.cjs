/**
 * Flags a Supabase `.update()` / `.delete()` whose chain never calls
 * `.select()`.
 *
 * PostgREST answers a write the RLS policy refuses with zero rows and
 * no error, so `if (error) throw error` alone cannot tell a refusal
 * from a success. Callers then report the row updated or deleted, and
 * it reappears on the next fetch. That shipped three times — the web
 * contact delete (#344), `deleteTodo` (#360) — before this rule.
 *
 * Reading the row back is the fix, and the codebase already does it in
 * the places that got it right:
 *
 *   const { data, error } = await supabase
 *     .from('todos').delete().eq('id', id).select('id');
 *   if (error) throw error;
 *   if (!data?.length) throw new Error('Todo not found');
 *
 * `.insert()` is deliberately not flagged: a refused insert violates
 * the policy's WITH CHECK and comes back as a real error (42501).
 *
 * Service-role callers bypass RLS, so zero rows there means the row is
 * genuinely absent rather than withheld. Those are the intended place
 * for an eslint-disable-next-line with a reason.
 */

const GUARDED_METHODS = new Set(['update', 'delete']);

/**
 * The client the chain was built from, e.g. `supabase`, `ctx.supabase`
 * or `supabaseAdmin()`, or null when this is not a `.from(...)` chain.
 */
function queryClient(node, sourceCode) {
  let current = node.callee.object;
  while (current) {
    if (
      current.type === 'CallExpression' &&
      current.callee.type === 'MemberExpression' &&
      current.callee.property.name === 'from'
    ) {
      return sourceCode.getText(current.callee.object);
    }
    if (current.type === 'CallExpression') {
      current = current.callee;
    } else if (current.type === 'MemberExpression') {
      current = current.object;
    } else {
      return null;
    }
  }
  return null;
}

/**
 * Only RLS-scoped clients are at risk. A service-role client bypasses
 * RLS, so zero rows there means the row is genuinely absent rather than
 * withheld, and demanding a `.select()` would be noise — those are the
 * `supabaseAdmin()` / `db` / `admin` roots this skips.
 */
function isRlsScopedName(client) {
  return client === 'supabase' || client.endsWith('.supabase');
}

/** Factories that hand back a service-role client. */
const ADMIN_FACTORIES = new Set(['supabaseAdmin', 'billingAdmin']);

/** Where a raw, key-carrying client comes from. */
const RAW_CLIENT_MODULE = '@supabase/supabase-js';

function resolveVariable(name, scope) {
  for (let s = scope; s; s = s.upper) {
    const found = s.variables.find((v) => v.name === name);
    if (found) return found;
  }
  return null;
}

/**
 * A local `const supabase = supabaseAdmin()` is service-role however it
 * is named, and naming alone cannot see that — several modules bind an
 * admin client to `supabase` and would otherwise be flagged for a check
 * that cannot apply to them.
 *
 * A client arriving as a parameter stays flagged: callers pass both
 * kinds (broadcasts/sender.ts takes `ctx.supabase` on one path and an
 * admin client on another), so the RLS-scoped reading is the safe one.
 */
function bindsServiceRoleClient(name, scope) {
  const variable = resolveVariable(name, scope);
  const def = variable?.defs?.[0];
  if (!def || def.type !== 'Variable') return false;

  const init = def.node.init;
  if (!init || init.type !== 'CallExpression') return false;
  if (init.callee.type !== 'Identifier') return false;

  const factory = init.callee.name;
  if (ADMIN_FACTORIES.has(factory)) return true;

  // `createClient` is both the browser/SSR helper and the raw
  // service-role constructor; only the raw one bypasses RLS.
  if (factory !== 'createClient') return false;
  const factoryVar = resolveVariable(factory, scope);
  const factoryDef = factoryVar?.defs?.[0];
  return (
    factoryDef?.type === 'ImportBinding' &&
    factoryDef.parent?.source?.value === RAW_CLIENT_MODULE
  );
}

/**
 * True when the call asks PostgREST for the affected-row count, as in
 * `.delete({ count: 'exact' })`. Reading that count answers the same
 * question `.select()` does, so it is an equally good guard.
 */
function countsAffectedRows(node) {
  return node.arguments.some(
    (arg) =>
      arg.type === 'ObjectExpression' &&
      arg.properties.some(
        (prop) =>
          prop.type === 'Property' &&
          !prop.computed &&
          (prop.key.name === 'count' || prop.key.value === 'count')
      )
  );
}

/** True when `.select()` is called further along the same chain. */
function hasSelectDownstream(node) {
  let current = node;
  let parent = current.parent;
  while (parent) {
    if (parent.type === 'MemberExpression' && parent.object === current) {
      if (parent.property.name === 'select') return true;
      current = parent;
    } else if (parent.type === 'CallExpression' && parent.callee === current) {
      current = parent;
    } else {
      return false;
    }
    parent = current.parent;
  }
  return false;
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require .select() on a Supabase update/delete so an RLS refusal is not read as success',
    },
    schema: [],
    messages: {
      missingSelect:
        "Chain .select() onto this .{{method}}() and check the returned rows. Without it an RLS refusal comes back as zero rows and no error, so a refused write reads as a successful one.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (
          node.callee.type !== 'MemberExpression' ||
          node.callee.computed ||
          !GUARDED_METHODS.has(node.callee.property.name)
        ) {
          return;
        }
        const client = queryClient(node, context.sourceCode);
        if (client === null || !isRlsScopedName(client)) return;
        if (
          !client.includes('.') &&
          bindsServiceRoleClient(client, context.sourceCode.getScope(node))
        ) {
          return;
        }
        if (countsAffectedRows(node)) return;
        if (hasSelectDownstream(node)) return;

        context.report({
          node: node.callee.property,
          messageId: 'missingSelect',
          data: { method: node.callee.property.name },
        });
      },
    };
  },
};
