const TITLE_PATTERN =
  /^(dr|mr|mrs|ms|miss|prof|shri|smt|sri|col|capt|major|adv|er)\.?$/i;

export function greetingName(name: string | null | undefined): string {
  const tokens = (name || '').trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return '';
  if (TITLE_PATTERN.test(tokens[0]) && tokens[1]) {
    return `${tokens[0]} ${tokens[1]}`;
  }
  return tokens[0];
}
