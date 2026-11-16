export function parseCoopPriceToken(value: string): number | null {
  const match = value.trim().match(/^(\d{1,4})(k|=\)|\)=)$/);
  if (!match) return null;

  const whole = Number(match[1]);
  if (!Number.isFinite(whole) || whole <= 0 || whole > 10_000) return null;

  if (match[2] === 'k') return whole;
  return whole + 0.9;
}
