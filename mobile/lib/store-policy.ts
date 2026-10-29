import { Platform } from 'react-native';

/**
 * Whether the UI may point at the web checkout.
 *
 * Both stores forbid a button, link or other call to action that steers
 * users to a purchasing mechanism outside their own billing for digital
 * content consumed in the app, and AI credits/plans are exactly that:
 * App Store Guideline 3.1.1 and the Google Play Payments policy. Both
 * still let a multiplatform service *use* what was bought elsewhere — so
 * in the native apps the balance, plan and ledger stay visible and only
 * the purchase paths disappear. Purchases happen on the web dashboard.
 */
export const SHOW_PURCHASE_LINKS = Platform.OS === 'web';
