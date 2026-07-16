import { describe, it, expect } from "vitest";
import { microphoneErrorMessage } from "./mic-error";

describe("microphoneErrorMessage", () => {
  it("points at the per-site permission toggle for NotAllowedError/SecurityError", () => {
    expect(microphoneErrorMessage(new DOMException("denied", "NotAllowedError"))).toMatch(
      /padlock|site-info/i
    );
    expect(microphoneErrorMessage(new DOMException("insecure", "SecurityError"))).toMatch(
      /padlock|site-info/i
    );
  });

  it("does not tell the user to 'allow' anything when no device exists", () => {
    const msg = microphoneErrorMessage(new DOMException("none", "NotFoundError"));
    expect(msg).toMatch(/no microphone/i);
    expect(msg).not.toMatch(/allow|blocked|denied/i);
  });

  it("blames another app/tab for NotReadableError/TrackStartError", () => {
    expect(microphoneErrorMessage(new DOMException("busy", "NotReadableError"))).toMatch(
      /in use by another/i
    );
    expect(microphoneErrorMessage(new DOMException("busy", "TrackStartError"))).toMatch(
      /in use by another/i
    );
  });

  it("falls back to a generic message for unknown/non-DOMException errors", () => {
    expect(microphoneErrorMessage(new Error("boom"))).toMatch(/couldn't start/i);
    expect(microphoneErrorMessage("boom")).toMatch(/couldn't start/i);
    expect(microphoneErrorMessage(undefined)).toMatch(/couldn't start/i);
  });
});
