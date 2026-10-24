// Formatting only: authoritative amounts and rounding come from Billing as decimal strings.
export function formatDecimal(value: string | number): string {
  const raw =
    typeof value === 'number'
      ? Number.isFinite(value) && Number.isSafeInteger(Math.round(value * 100))
        ? value.toFixed(2)
        : ''
      : value;
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(raw)) return '—';
  const [whole, fraction = ''] = raw.split('.');
  return BigInt(whole).toLocaleString('en-IN') + '.' + fraction.padEnd(2, '0');
}
