import { useEffect, useState } from 'react';
import { api, money } from '../api';

// Editor de packs de chances + oferta "Duplicá" de un sorteo.
// La vista previa ("así lo ve el comprador") la calcula el backend: acá no se suman precios.
const toRows = (packs) => packs.map(({ id, chances, price, featured, doubleEligible }) => ({ id, chances, price: Number(price), featured, doubleEligible }));

export default function PackEditor({ raffleId }) {
  const [rows, setRows] = useState(null);
  const [offer, setOffer] = useState({ enabled: false, pricePerChance: '' });
  const [preview, setPreview] = useState([]);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  function load(data) {
    setRows(toRows(data.packs));
    setOffer(data.offer);
    setPreview(data.preview);
    setDirty(false);
  }

  useEffect(() => {
    api(`/admin/raffles/${raffleId}/packs`, { auth: true }).then(load).catch((e) => setMsg({ type: 'alert', text: e.message }));
  }, [raffleId]);

  if (!rows) return null;

  const change = (next) => { setRows(next); setDirty(true); setMsg(null); };
  const set = (i, k, v) => change(rows.map((r, j) => (j === i ? { ...r, [k]: v } : k === 'featured' && v ? { ...r, featured: false } : r)));
  const move = (i, d) => {
    const next = [...rows];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    change(next);
  };
  const setOfferField = (k, v) => { setOffer({ ...offer, [k]: v }); setDirty(true); setMsg(null); };

  async function save() {
    setBusy(true);
    try {
      const body = {
        packs: rows.map((r, i) => ({ ...r, chances: Number(r.chances), price: Number(r.price), position: i })),
        offer: { enabled: offer.enabled, pricePerChance: Number(offer.pricePerChance) },
      };
      load(await api(`/admin/raffles/${raffleId}/packs`, { method: 'PUT', auth: true, body }));
      setMsg({ type: 'ok', text: 'Packs guardados' });
    } catch (e) {
      setMsg({ type: 'alert', text: e.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card mt">
      <div className="row between">
        <h2>Packs de chances</h2>
        {dirty && <span className="small muted">Cambios sin guardar</span>}
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr><th>Orden</th><th>Chances</th><th>Precio</th><th>El más elegido</th><th>Ofrece "Duplicá"</th><th /></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id || `new-${i}`}>
                <td>
                  <div className="row" style={{ flexWrap: 'nowrap' }}>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Subir">↑</button>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={i === rows.length - 1} onClick={() => move(i, 1)} aria-label="Bajar">↓</button>
                  </div>
                </td>
                <td><input type="number" min="1" value={r.chances} onChange={(e) => set(i, 'chances', e.target.value)} /></td>
                <td><input type="number" min="1" value={r.price} onChange={(e) => set(i, 'price', e.target.value)} /></td>
                <td><input type="radio" name={`featured-${raffleId}`} checked={!!r.featured} onChange={() => set(i, 'featured', true)} /></td>
                <td><input type="checkbox" checked={r.doubleEligible} onChange={(e) => set(i, 'doubleEligible', e.target.checked)} /></td>
                <td><button type="button" className="btn btn-ghost btn-sm" disabled={rows.length === 1} onClick={() => change(rows.filter((_, j) => j !== i))}>Quitar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row mt-sm">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => change([...rows, { chances: '', price: '', featured: false, doubleEligible: true }])}>+ Agregar pack</button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={!rows.some((r) => r.featured)} onClick={() => change(rows.map((r) => ({ ...r, featured: false })))}>Quitar "El más elegido"</button>
      </div>

      <h3 className="mt">Oferta "Duplicá tus chances"</h3>
      <div className="row">
        <label className="check"><input type="checkbox" checked={offer.enabled} onChange={(e) => setOfferField('enabled', e.target.checked)} /> Activa</label>
        <label className="row">Precio por chance extra ($)
          <input type="number" min="1" style={{ width: '8rem' }} disabled={!offer.enabled} value={offer.pricePerChance} onChange={(e) => setOfferField('pricePerChance', e.target.value)} />
        </label>
      </div>
      <p className="small muted">Con "Duplicá", el comprador recibe el doble de chances y paga el pack más el precio por cada chance extra.</p>

      {msg && <p className={`${msg.type} mt-sm`}>{msg.text}</p>}
      <button className="btn mt-sm" disabled={busy || !dirty} onClick={save}>{busy ? 'Guardando…' : 'Guardar packs'}</button>

      <h3 className="mt">Así lo ve el comprador</h3>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Pack</th><th>Precio</th><th>Con "Duplicá"</th></tr></thead>
          <tbody>
            {preview.map((p) => (
              <tr key={p.id}>
                <td>{p.chances} chances {p.featured && <span className="status s-active">El más elegido</span>}</td>
                <td>{money(p.price)}</td>
                <td>{p.double ? `${p.double.chances} chances por ${money(p.double.total)}` : <span className="muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {dirty && <p className="small muted mt-sm">La vista previa se actualiza al guardar.</p>}
    </div>
  );
}
