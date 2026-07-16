/**
 * `getUserMedia({ audio: true })` throws a `DOMException` for several
 * distinct real causes — permission denial is only one of them. Prior
 * to this, every failure surfaced the same "Microphone access denied"
 * toast, which is actively misleading when the real cause is "no mic
 * connected" or "mic in use by another app" (nothing to "allow" there),
 * and doesn't point the user at the actual fix when it IS a permission
 * problem (the per-site toggle behind the address-bar padlock/site-info
 * icon, distinct from an OS-level "Chrome can use the microphone"
 * toggle — a user can have the OS toggle on and still be blocked here).
 */
export function microphoneErrorMessage(err: unknown): string {
  const name = err instanceof DOMException ? err.name : null;

  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Microphone blocked for this site. Click the padlock/site-info icon next to the address bar, allow Microphone, then reload the page.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No microphone found. Connect a microphone (or check your OS's default input device) and try again.";
    case "NotReadableError":
    case "TrackStartError":
      return "Couldn't access the microphone — it may be in use by another app or tab. Close it and try again.";
    case "AbortError":
      return "Microphone access was interrupted. Try again.";
    default:
      return "Couldn't start the microphone. Allow the mic to log events by voice.";
  }
}
