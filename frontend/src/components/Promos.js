import { money } from '../api';

export function promoList(raffle) {
  return [{ qty: 1, price: Number(raffle.pricePerNumber) }, ...(raffle.promos || []).map((p) => ({ qty: p.qty, price: Number(p.price) }))]
    .sort((a, b) => a.qty - b.qty);
}

// Tarjetas "1 x $10.000 · 2 x $15.000 ...". Si se pasa onPick, son botones.
export default function Promos({ raffle, onPick, active }) {
  const list = promoList(raffle);
  const unit = Number(raffle.pricePerNumber);
  const best = list.reduce((b, p) => (p.price / p.qty < b.price / b.qty ? p : b), list[0]);
  return (
    <div className="promos">
      {list.map((p) => {
        const off = Math.round((1 - p.price / (unit * p.qty)) * 100);
        const Tag = onPick ? 'button' : 'div';
        return (
          <Tag
            key={p.qty}
            type={onPick ? 'button' : undefined}
            className={`promo ${p === best && list.length > 1 ? 'promo-best' : ''} ${active === p.qty ? 'promo-active' : ''}`}
            onClick={onPick ? () => onPick(p.qty) : undefined}
          >
            {p === best && list.length > 1 && <span className="promo-tag">Más conviene</span>}
            <span className="promo-qty">{p.qty} {p.qty === 1 ? 'número' : 'números'}</span>
            <span className="promo-price">{money(p.price)}</span>
            {off > 0 ? <span className="promo-off">{off}% off</span> : <span className="promo-off muted">precio base</span>}
          </Tag>
        );
      })}
    </div>
  );
}

// Editor de promos para el panel
export function PromoEditor({ value, onChange }) {
  const rows = value || [];
  const set = (i, k, v) => onChange(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div>
      {rows.map((r, i) => (
        <div className="row promo-row" key={i}>
          <input type="number" min="2" placeholder="Cantidad" value={r.qty} onChange={(e) => set(i, 'qty', e.target.value)} />
          <span className="muted">números por $</span>
          <input type="number" min="1" placeholder="Precio" value={r.price} onChange={(e) => set(i, 'price', e.target.value)} />
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange(rows.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange([...rows, { qty: '', price: '' }])}>+ Agregar promo</button>
    </div>
  );
}

export const cleanPromos = (rows) =>
  (rows || []).filter((r) => Number(r.qty) > 1 && Number(r.price) > 0).map((r) => ({ qty: Number(r.qty), price: Number(r.price) }));
