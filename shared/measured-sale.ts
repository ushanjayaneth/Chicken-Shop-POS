import {isWeightedUnit, lineAmount, roundSaleQuantity, validSaleQuantity} from './retail';
import {convertQuantity} from './units';

export function measurementUnit(unit: string): string {
  return ['litre', 'liter', 'l'].includes(unit.toLowerCase()) ? 'L' : unit.toLowerCase();
}

export function measuredSaleQuantity(inputQuantity: number, inputUnit: string, saleUnit: string): number | null {
  if (!isWeightedUnit(saleUnit) || !Number.isFinite(inputQuantity) || inputQuantity <= 0) return null;
  try {
    const quantity = convertQuantity(inputQuantity, measurementUnit(inputUnit), measurementUnit(saleUnit));
    return validSaleQuantity(quantity, saleUnit) ? roundSaleQuantity(quantity) : null;
  } catch {
    return null;
  }
}

export interface MeasuredSaleQuote {
  quantity: number;
  amount: number;
  remainder: number;
}

/** Round a budget down to supported stock precision, using the existing bill calculation. */
export function measuredSaleForBudget(budgetMinor: number, unitPrice: number, saleUnit: string): MeasuredSaleQuote | null {
  if (!isWeightedUnit(saleUnit) || !Number.isSafeInteger(budgetMinor) || budgetMinor <= 0 ||
      !Number.isSafeInteger(unitPrice) || unitPrice <= 0) return null;
  const milliUnits = BigInt(budgetMinor) * 1000n / BigInt(unitPrice);
  if (milliUnits < 1n || milliUnits > 1_000_000n) return null;
  const quantity = Number(milliUnits) / 1000;
  const amount = lineAmount(unitPrice, quantity);
  if (!validSaleQuantity(quantity, saleUnit) || !Number.isSafeInteger(amount) || amount > budgetMinor) return null;
  return {quantity, amount, remainder: budgetMinor - amount};
}