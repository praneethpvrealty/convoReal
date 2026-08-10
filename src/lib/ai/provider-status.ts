// ============================================================
// Availability of the flyer image providers, resolved server-side.
//
// The settings panel is a tenant-facing surface: a brokerage on the
// managed deployment has no shell and no .env.local, so the only
// useful signal there is whether a provider works on their account.
// The env-var names are provisioning detail and are returned only
// when the deployment is self-hosted, where the person reading the
// panel is also the person who can act on it.
// ============================================================

export type ImageProviderId = 'huggingface' | 'google' | 'stability';

export interface ImageProviderStatus {
  id: ImageProviderId;
  available: boolean;
  envVar?: string;
}

export interface ImageProvidersStatus {
  selfHosted: boolean;
  providers: ImageProviderStatus[];
}

export function isSelfHosted(): boolean {
  return process.env.NEXT_PUBLIC_SELF_HOSTED === 'true';
}

export function getImageProvidersStatus(): ImageProvidersStatus {
  const selfHosted = isSelfHosted();

  const keys: Record<ImageProviderId, { envVar: string; value: string | undefined }> = {
    huggingface: { envVar: 'HF_ACCESS_TOKEN', value: process.env.HF_ACCESS_TOKEN },
    google: { envVar: 'GEMINI_API_KEY', value: process.env.GEMINI_API_KEY },
    stability: { envVar: 'STABILITY_API_KEY', value: process.env.STABILITY_API_KEY },
  };

  const providers = (Object.keys(keys) as ImageProviderId[]).map((id) => ({
    id,
    available: Boolean(keys[id].value),
    ...(selfHosted ? { envVar: keys[id].envVar } : {}),
  }));

  return { selfHosted, providers };
}
