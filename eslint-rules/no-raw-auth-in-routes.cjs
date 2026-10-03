/**
 * Flags `auth.getUser()` inside an API route file.
 *
 * A route resolves its caller with `getCurrentAccount()` /
 * `requireRole()` from `@/lib/auth/account`, `requirePlatformAdmin()`
 * from `@/lib/auth/platform-admin`, or `withDenAuth()` /
 * `withBuyerAuth()` / `withApiKeyAuth()`, and reports failures with
 * `toErrorResponse()`. A hand-rolled `auth.getUser()` plus a profiles
 * lookup skips the archived-account block and the role check, and
 * eleven admin routes had each re-implemented the super_admin check
 * while `requirePlatformAdmin()` sat beside them.
 *
 * The routes that run before a caller has an account, or for a
 * persona that never gets one (profile setup, invitation redemption,
 * Den and buyer sign-in completion), are exempted in eslint.config.mjs.
 */

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Resolve the caller in API routes through the shared auth helpers, not auth.getUser()',
    },
    schema: [],
    messages: {
      raw: 'Resolve the caller with getCurrentAccount() / requireRole() / requirePlatformAdmin() and report failures with toErrorResponse(), not with auth.getUser() in a route.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const callee = node.callee;
        if (
          callee.type !== 'MemberExpression' ||
          callee.property.type !== 'Identifier' ||
          callee.property.name !== 'getUser'
        ) {
          return;
        }
        const obj = callee.object;
        if (
          obj.type === 'MemberExpression' &&
          obj.property.type === 'Identifier' &&
          obj.property.name === 'auth'
        ) {
          context.report({ node, messageId: 'raw' });
        }
      },
    };
  },
};
