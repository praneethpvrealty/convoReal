export function propertyEditKeyboardBehavior(platform: string): 'padding' | 'position' {
  return platform === 'ios' ? 'padding' : 'position';
}
