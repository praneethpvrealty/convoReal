export interface ShowcaseCardMotion {
  rotateXDegrees: number;
  translateYPercent: number;
  translateZPixels: number;
  scale: number;
  opacity: number;
}

export function showcaseCardMotion(
  distanceFromCenter: number,
  mobileDeck: boolean
): ShowcaseCardMotion {
  const distance = Math.max(-1, Math.min(1, distanceFromCenter));
  const depth = Math.abs(distance);

  if (mobileDeck) {
    return {
      rotateXDegrees: 0,
      translateYPercent: 0,
      translateZPixels: 0,
      scale: 1,
      opacity: 1,
    };
  }

  return {
    rotateXDegrees: 0,
    translateYPercent: distance * 1.25,
    translateZPixels: depth * -42,
    scale: 1 - depth * 0.012,
    opacity: 1 - depth * 0.08,
  };
}
