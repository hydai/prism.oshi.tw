/** Format raw subscriber count into Traditional Chinese notation (萬 = 10,000). */
export function formatSubscriberCount(count: number): string {
  if (count < 10000) {
    return count.toLocaleString();
  }
  const wan = count / 10000;
  if (Number.isInteger(wan)) {
    return `${wan}萬`;
  }
  const formatted = wan.toFixed(2).replace(/\.?0+$/, '');
  return `${formatted}萬`;
}
