import { describe, expect, it } from "vitest";

import {
  MEDIA_CAPTION_LIMIT,
  MEDIA_SIZE_LIMITS,
  mediaKindForMime,
  normalizeCaption,
  rejectMedia,
} from "./media-kinds";

describe("mediaKindForMime", () => {
  it("maps each family to the kind Meta expects", () => {
    expect(mediaKindForMime("image/jpeg")).toBe("image");
    expect(mediaKindForMime("video/mp4")).toBe("video");
    expect(mediaKindForMime("audio/ogg")).toBe("audio");
    expect(mediaKindForMime("application/pdf")).toBe("document");
  });

  it("ignores codec parameters a recorder appends", () => {
    expect(mediaKindForMime("audio/ogg; codecs=opus")).toBe("audio");
    expect(mediaKindForMime("VIDEO/MP4")).toBe("video");
  });

  it("refuses types WhatsApp does not take", () => {
    expect(mediaKindForMime("image/svg+xml")).toBeNull();
    expect(mediaKindForMime("image/gif")).toBeNull();
    expect(mediaKindForMime("application/zip")).toBeNull();
    expect(mediaKindForMime(null)).toBeNull();
    expect(mediaKindForMime("")).toBeNull();
  });
});

describe("rejectMedia", () => {
  it("accepts a file inside its kind's cap", () => {
    expect(rejectMedia("image/jpeg", 2 * 1024 * 1024)).toBeNull();
    expect(rejectMedia("image/jpeg", MEDIA_SIZE_LIMITS.image)).toBeNull();
  });

  it("rejects an unsupported type before size is considered", () => {
    expect(rejectMedia("application/zip", 10)?.code).toBe(
      "UNSUPPORTED_MEDIA_TYPE",
    );
  });

  it("rejects a file over its own kind's cap", () => {
    const rejection = rejectMedia("image/jpeg", MEDIA_SIZE_LIMITS.image + 1);
    expect(rejection?.code).toBe("MEDIA_TOO_LARGE");
    expect(rejection?.error).toContain("image");
  });

  it("applies each kind's own cap, not one global limit", () => {
    // 20 MB: fine as a document, too big as a video.
    const twentyMb = 20 * 1024 * 1024;
    expect(rejectMedia("application/pdf", twentyMb)).toBeNull();
    expect(rejectMedia("video/mp4", twentyMb)?.code).toBe("MEDIA_TOO_LARGE");
  });

  it("reports sizes in a unit the agent reads, not bytes", () => {
    const rejection = rejectMedia("video/mp4", 40 * 1024 * 1024);
    expect(rejection?.error).toContain("16 MB");
    expect(rejection?.error).toContain("40 MB");
  });
});

describe("normalizeCaption", () => {
  it("keeps a caption on the kinds that render one", () => {
    expect(normalizeCaption("image", "  a flat in Kondapur ")).toBe(
      "a flat in Kondapur",
    );
    expect(normalizeCaption("document", "brochure")).toBe("brochure");
  });

  it("drops the caption on audio, which never shows one", () => {
    expect(normalizeCaption("audio", "listen to this")).toBeUndefined();
  });

  it("truncates rather than letting Meta refuse the send", () => {
    const long = "x".repeat(MEDIA_CAPTION_LIMIT + 500);
    expect(normalizeCaption("image", long)).toHaveLength(MEDIA_CAPTION_LIMIT);
  });

  it("treats blank as no caption", () => {
    expect(normalizeCaption("image", "   ")).toBeUndefined();
    expect(normalizeCaption("image", null)).toBeUndefined();
  });
});
