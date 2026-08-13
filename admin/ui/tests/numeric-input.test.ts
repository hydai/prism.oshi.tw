import { strict as assert } from 'node:assert';
import { finiteInputNumber, isNumberInRange } from '../src/lib/numeric-input';

assert.equal(finiteInputNumber(0.85), 0.85, 'finite decimals remain editable values');
assert.equal(finiteInputNumber(0), 0, 'an explicit zero remains distinct from a cleared field');
assert.equal(finiteInputNumber(Number.NaN), undefined, 'a cleared number input cannot store NaN');
assert.equal(finiteInputNumber(Number.POSITIVE_INFINITY), undefined, 'infinite values are rejected');

assert.equal(isNumberInRange(0.5, 0.5, 1), true, 'the lower threshold boundary is valid');
assert.equal(isNumberInRange(1, 0.5, 1), true, 'the upper threshold boundary is valid');
assert.equal(isNumberInRange(0.49, 0.5, 1), false, 'thresholds below the minimum are invalid');
assert.equal(isNumberInRange(undefined, 0.5, 1), false, 'a cleared threshold is invalid');

console.log('✓ Numeric inputs reject empty and non-finite values');
