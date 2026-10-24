import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDecimal } from '../../apps/workshop-dashboard/src/lib/decimal.ts';
test('currency display keeps large decimal strings exact without converting to floating point', () => {
  assert.equal(formatDecimal('99999999999999999.99').replaceAll(',', ''), '99999999999999999.99');
  assert.equal(formatDecimal('1234567.89'), '12,34,567.89');
  assert.equal(formatDecimal('708'), '708.00');
  assert.equal(formatDecimal('0.01'), '0.01');
  assert.equal(formatDecimal(Number.MAX_SAFE_INTEGER), '—');
});
