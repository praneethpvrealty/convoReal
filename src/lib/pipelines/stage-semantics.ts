export type PipelineOutcome = 'active' | 'successful' | 'lost';

function normalizedStageName(stageName: string): string {
  return stageName.trim().toLowerCase();
}

export function isLostStage(stageName: string): boolean {
  return normalizedStageName(stageName).includes('lost');
}

export function isBrokeragePaidStage(stageName: string): boolean {
  const name = normalizedStageName(stageName);
  return name.includes('brokerage') && name.includes('paid');
}

export function isBrokeragePendingStage(stageName: string): boolean {
  const name = normalizedStageName(stageName);
  return name.includes('brokerage') && name.includes('pending');
}

export function pipelineOutcomeForStage(stageName: string): PipelineOutcome {
  const name = normalizedStageName(stageName);
  if (isLostStage(name)) return 'lost';
  if (
    name.includes('won') ||
    name.includes('registered') ||
    name.includes('brokerage')
  ) {
    return 'successful';
  }
  return 'active';
}

export function dealStatusForStage(stageName: string): 'open' | 'won' | 'lost' {
  const outcome = pipelineOutcomeForStage(stageName);
  if (outcome === 'lost') return 'lost';
  if (outcome === 'successful') return 'won';
  return 'open';
}

export function propertyStatusForPipelineStage(
  stageName: string
): 'Available' | 'Under Contract' | 'Sold' | null {
  const name = normalizedStageName(stageName);
  const outcome = pipelineOutcomeForStage(name);
  if (outcome === 'lost') return 'Available';
  if (outcome === 'successful') return 'Sold';
  if (name.includes('negotiation') || name.includes('token')) {
    return 'Under Contract';
  }
  return null;
}

export function shouldCaptureBrokerage(stageName: string): boolean {
  const name = normalizedStageName(stageName);
  return (
    pipelineOutcomeForStage(name) === 'successful' ||
    name.includes('negotiation') ||
    name.includes('token') ||
    name.includes('due diligence') ||
    name.includes('contract')
  );
}
