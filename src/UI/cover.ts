/** A stable hue (0-359) for a title, so each game keeps the same cover colour. */
export function coverHue(title: string): number {
  let hash = 0;
  for (let i = 0; i < title.length; i += 1) hash = (hash * 31 + title.charCodeAt(i)) >>> 0;
  return hash % 360;
}

/** Up to two capital letters from a title ("Stardew Valley" -> "SV"), or "?" when it has none. */
export function initials(title: string): string {
  const words = title.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (words.length === 0) return '?';
  return words
    .slice(0, 2)
    .map((word) => word.charAt(0))
    .join('')
    .toUpperCase();
}
