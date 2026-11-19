import {useState, type KeyboardEvent} from 'react';
import type {MenuItem} from '../../shared/types';
import {isWeightedUnit, lineAmount} from '../../shared/retail';
import {compatibleUnits, convertQuantity} from '../../shared/units';
import {measurementUnit, measuredSaleForBudget, measuredSaleQuantity} from '../../shared/measured-sale';
import {money, number} from '../lib/format';
import {Modal} from './ui';
import {NumberPadKeys} from './NumberPad';
import '../styles/measured-sale.css';

type EntryMode = 'quantity' | 'amount';
const convertedQuantityFormat = new Intl.NumberFormat('en-LK', {maximumFractionDigits: 6});

export default function MeasuredSaleDialog({item, quantity, onClose, onConfirm}: {
  item: MenuItem;
  quantity: number;
  onClose: () => void;
  onConfirm: (quantity: number) => void;
}) {
  const saleUnit = item.saleUnit || 'kg';
  const stockUnit = measurementUnit(saleUnit);
  const units = compatibleUnits(stockUnit).filter(unit => unit !== 'mg');
  const [mode, setMode] = useState<EntryMode>('quantity');
  const [unit, setUnit] = useState(stockUnit);
  const [text, setText] = useState(String(quantity));
  const [replace, setReplace] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const isMass = units.includes('kg');
  const amountTextValid = /^\d*\.?\d{0,2}$/.test(text) && text !== '' && text !== '.';
  const budget = amountTextValid ? Math.round(Number(text) * 100) : NaN;
  const measuredQuantity = text === '' ? null : measuredSaleQuantity(Number(text), unit, saleUnit);
  const quote = mode === 'amount' ? measuredSaleForBudget(budget, item.price, saleUnit) :
    measuredQuantity === null ? null : {quantity: measuredQuantity, amount: lineAmount(item.price, measuredQuantity), remainder: 0};
  const stepUnit = stockUnit === 'kg' ? 'g' : stockUnit === 'L' ? 'ml' : stockUnit;
  const minimum = convertQuantity(.001, stockUnit, stepUnit);
  const error = mode === 'amount' && item.price <= 0 ? 'Set a selling price to calculate quantity from an amount.' :
    mode === 'amount' ? 'Enter a valid amount that buys at least the minimum quantity.' :
    `Enter up to 1,000 ${stockUnit} in steps of ${number(minimum)} ${stepUnit}.`;

  function changeText(value: string) {
    if (!/^\d*\.?\d*$/.test(value) || value.length > 16) return;
    setText(value);
    setReplace(false);
    setSubmitted(false);
  }

  function key(value: string) {
    setSubmitted(false);
    if (value === 'clear') {setText('');setReplace(false);return;}
    if (value === 'back') {setText(previous => previous.slice(0, -1));setReplace(false);return;}
    const current = replace ? '' : text;
    if (value === '.') {
      if (!current.includes('.')) changeText(current ? `${current}.` : '0.');
      return;
    }
    changeText(current === '0' ? value : current + value);
  }

  function switchMode(nextMode: EntryMode) {
    if (mode === nextMode) return;
    const currentQuantity = quote?.quantity ?? quantity;
    setText(nextMode === 'amount' ? (lineAmount(item.price, currentQuantity) / 100).toFixed(2) :
      String(convertQuantity(currentQuantity, stockUnit, unit)));
    setMode(nextMode);
    setReplace(true);
    setSubmitted(false);
  }

  function switchUnit(nextUnit: string) {
    const currentQuantity = quote?.quantity ?? quantity;
    setUnit(nextUnit);
    if (mode === 'quantity') setText(String(convertQuantity(currentQuantity, stockUnit, nextUnit)));
    setReplace(true);
    setSubmitted(false);
  }

  function apply() {
    if (!quote || !isWeightedUnit(saleUnit)) {setSubmitted(true);return;}
    onConfirm(quote.quantity);
  }

  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target instanceof HTMLSelectElement) return;
    if (event.target instanceof HTMLInputElement) {
      if (event.key === 'Enter') {event.preventDefault();apply();}
      return;
    }
    if (/^[0-9.]$/.test(event.key)) {event.preventDefault();key(event.key);}
    else if (event.key === 'Backspace') {event.preventDefault();key('back');}
    else if (event.key === 'Delete') {event.preventDefault();key('clear');}
  }

  const alternateUnit = stockUnit === 'kg' ? 'g' : stockUnit === 'g' ? 'kg' : stockUnit === 'L' ? 'ml' : 'L';
  return <Modal title="Item quantity" subtitle={item.name} onClose={onClose}>
    <div className="number-pad measured-sale" onKeyDown={keyboard}>
      <div className="measured-rate">{money(item.price)} / {stockUnit}</div>
      <div className="measured-mode" role="tablist" aria-label="Quantity entry mode">
        <button type="button" role="tab" aria-selected={mode === 'quantity'} onClick={() => switchMode('quantity')}>{isMass ? 'Weight' : 'Quantity'}</button>
        <button type="button" role="tab" aria-selected={mode === 'amount'} onClick={() => switchMode('amount')}>Amount</button>
      </div>
      <div className="measured-entry">
        <label className="field"><span>{mode === 'amount' ? 'Amount (LKR)' : isMass ? 'Weight' : 'Quantity'}</span>
          <input className="input" type="text" inputMode="decimal" autoComplete="off"
            aria-label={mode === 'amount' ? 'Amount (LKR)' : isMass ? 'Weight' : 'Quantity'} value={text}
            onChange={event => changeText(event.target.value)} onFocus={event => {event.currentTarget.select();setReplace(true);}}/>
        </label>
        {mode === 'quantity' && <label className="field"><span>Unit</span>
          <select className="input" aria-label="Unit" value={unit} onChange={event => switchUnit(event.target.value)}>
            {units.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>}
      </div>
      <div className="measured-summary" aria-live="polite">
        <div><span>Quantity</span><output aria-label="Calculated quantity">{quote ? `${number(quote.quantity)} ${stockUnit}` : '—'}</output></div>
        {quote && <small>{convertedQuantityFormat.format(convertQuantity(quote.quantity, stockUnit, alternateUnit))} {alternateUnit}</small>}
        <div><span>Line total</span><output aria-label="Calculated total">{quote ? money(quote.amount) : '—'}</output></div>
        {quote && quote.remainder > 0 && <small>Weight uses {number(minimum)} {stepUnit} steps. Final charge is {money(quote.remainder)} below the entered amount.</small>}
      </div>
      <NumberPadKeys decimal onKey={key}/>
      {submitted && !quote && <div className="error-message" role="alert">{error}</div>}
      <div className="number-pad-actions">
        <button className="button" type="button" onClick={() => key('clear')}>Clear</button>
        <button className="button button-primary" type="button" onClick={apply}>Apply</button>
      </div>
    </div>
  </Modal>;
}