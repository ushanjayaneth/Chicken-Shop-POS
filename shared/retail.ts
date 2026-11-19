/** Retail prices are per sale unit; quantities have at most three decimal places. */
export type PriceMode = 'retail' | 'wholesale';
export function salePrice(item:{price:number;wholesalePrice?:number},mode:PriceMode='retail'):number {
  return mode==='wholesale' && Number.isSafeInteger(item.wholesalePrice) && Number(item.wholesalePrice)>0 ? item.wholesalePrice! : item.price;
}
export const saleUnits = ['pcs', 'pack', 'box', 'kg', 'g', 'litre', 'ml'] as const;
export const isWeightedUnit = (unit = 'pcs') => ['kg', 'g', 'litre', 'liter', 'l', 'ml'].includes(unit.toLowerCase());
export function validSaleQuantity(quantity: number, unit = 'pcs'): boolean {
  return Number.isFinite(quantity) && quantity > 0 && quantity <= 1000 &&
    Math.abs(quantity * 1000 - Math.round(quantity * 1000)) < 1e-7 &&
    (isWeightedUnit(unit) || Number.isInteger(quantity));
}
/** Round once per line so the cart, saved bill and printed receipt agree. */
export const lineAmount = (unitPrice: number, quantity: number) => Math.round(unitPrice * quantity);
export const roundSaleQuantity = (quantity: number) => Math.round(quantity * 1000) / 1000;
