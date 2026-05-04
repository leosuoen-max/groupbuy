export function formatMYR(amount: number): string {
  const fixed = Number.isInteger(amount) ? amount.toFixed(0) : amount.toFixed(1);
  return `RM ${fixed}`;
}
