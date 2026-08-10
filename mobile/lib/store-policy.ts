import { Platform } from 'react-native';

/**
 * Whether the UI may point at the web checkout.
 *
 * App Store Guideline 3.1.1 forbids buttons, links or any other call to
 * action that steers users to a purchasing mechanism outside In-App
 * Purchase, and AI credits/plans are digital content consumed in the
 * app. 3.1.3(b) still lets a multiplatform service *use* what was
 * bought elsewhere — so on iOS the balance, plan and ledger stay
 * visible and only the purchase paths disappear. Android is unaffected.
 */
export const SHOW_PURCHASE_LINKS = Platform.OS !== 'ios';
