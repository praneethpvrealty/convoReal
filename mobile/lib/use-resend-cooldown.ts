import { useCallback, useEffect, useState } from 'react';

export const OTP_RESEND_SECONDS = 30;

export function useResendCooldown(seconds: number = OTP_RESEND_SECONDS) {
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const startCooldown = useCallback(() => setResendIn(seconds), [seconds]);

  return { resendIn, startCooldown };
}
