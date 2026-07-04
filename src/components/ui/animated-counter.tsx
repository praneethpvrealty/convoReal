"use client";

import { useEffect, useState, useRef } from "react";

interface AnimatedCounterProps {
  value: number;
  duration?: number;
  className?: string;
}

export function AnimatedCounter({
  value,
  duration = 1000,
  className,
}: AnimatedCounterProps) {
  const [displayValue, setDisplayValue] = useState(value);
  const previousValueRef = useRef(value);

  useEffect(() => {
    const startValue = previousValueRef.current;
    const targetValue = value;
    if (startValue === targetValue) {
      return;
    }

    const startTime = performance.now();
    let animationFrameId: number;

    const updateCounter = (currentTime: number) => {
      const elapsedTime = currentTime - startTime;
      if (elapsedTime >= duration) {
        setDisplayValue(targetValue);
        previousValueRef.current = targetValue;
      } else {
        const progress = elapsedTime / duration;
        // Ease out cubic for a smoother finish
        const easeProgress = 1 - Math.pow(1 - progress, 3);
        const nextValue = Math.round(startValue + (targetValue - startValue) * easeProgress);
        setDisplayValue(nextValue);
        animationFrameId = requestAnimationFrame(updateCounter);
      }
    };

    animationFrameId = requestAnimationFrame(updateCounter);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [value, duration]);

  return <span className={className}>{displayValue}</span>;
}
