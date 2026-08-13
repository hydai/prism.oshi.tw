export function finiteInputNumber(valueAsNumber: number): number | undefined {
  return Number.isFinite(valueAsNumber) ? valueAsNumber : undefined;
}

export function isNumberInRange(
  value: number | undefined,
  min: number,
  max: number,
): value is number {
  return value !== undefined && Number.isFinite(value) && value >= min && value <= max;
}
