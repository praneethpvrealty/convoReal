export function propertyEditKeyboardBehavior(platform: string): 'padding' | 'height' {
  return platform === 'ios' ? 'padding' : 'height';
}
