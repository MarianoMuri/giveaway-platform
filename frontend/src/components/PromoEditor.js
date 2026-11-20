import { useEffect, useState } from 'react';
import { api, dateTime } from '../api';

// Promos y cupones de un sorteo. Cada promo da UNA cosa (descuento % o chances de regalo "por cada X"), con código o
// automática, y tiene sus propias fechas. Pueden estar varias a la vez. El interruptor las prende y apaga al instante.
// Los precios los calcula el backend.

const STATE = {
  on: { label: 'Activa', cls: 's-active' },
  off: { label: 'Apagada', cls: '' },
  scheduled: { label: 'Programada', cls: 'free-unconfirmed' },
  expired: { label: 'Vencida', cls: 'free-void' },
  soldout: { label: 'Agotada', cls: 'free-void' },
};

const EMPTY = { name: '', type: 'percent', percent: '', bonus: '', bonusEvery: '', useCode: false, minChances: '', code: '', startsAt: '', endsAt: '', maxUses: '', enabled: true };

// datetime-local trabaja con la hora del que mira, sin zona: se convierte al guardar y al leer
const toLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fromLocalInput = (v) => (v ? new Date(v).toISOString() : null);

const describe = (p) => (p.bonus > 0
  ? `${p.bonus} ${p.bonus === 1 ? 'chance' : 'chances'} de regalo por cada ${p.bonusEvery} comprada${p.bonusEvery === 1 ? '' : 's'}`
  : `${p.percent}% de descuento`);

const toForm = (p) => ({
  name: p.name, type: p.bonus > 0 ? 'bonus' : 'percent', percent: p.percent || '', bonus: p.bonus || '', bonusEvery: p.bonus > 0 ? p.bonusEvery : '',
  useCode: !!p.code, minChances: p.minChances || '', code: p.code || '',
  startsAt: toLocalInput(p.startsAt), endsAt: toLocalInput(p.endsAt), maxUses: p.maxUses || '', enabled: p.enabled,
});

export default function PromoEditor({ raffleId, mode = 'best', onModeChange }) {
  const base = `/admin/raffles/${raffleId}/promos`;
  const [list, setList] = useState(null);
  const [form, setForm] = useState(null); // null = cerrado; { id?, ...campos }
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null);

  useEffect(() => {
    api(base, { auth: true }).then(setList).catch((e) => setMsg({ type: 'alert', text: e.message }));
  }, [base]);

  if (!list) return msg ? <p className="alert">{msg.text}</p> : null;

  const body = (f) => ({
    name: f.name, percent: f.type === 'percent' ? Number(f.percent) : 0, bonus: f.type === 'bonus' ? Number(f.bonus) : 0,
    bonusEvery: f.type === 'bonus' ? Number(f.bonusEvery) : 1, minChances: f.minChances === '' ? 0 : Number(f.minChances),
    code: f.useCode ? f.code : '', startsAt: fromLocalInput(f.startsAt), endsAt: fromLocalInput(f.endsAt),
    maxUses: f.maxUses === '' ? null : Number(f.maxUses), enabled: f.enabled,
  });
  const upsert = (saved) => setList((cur) => (cur.some((p) => p.id === saved.id) ? cur.map((p) => (p.id === saved.id ? saved : p)) : [...cur, saved]));

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const saved = form.id
        ? await api(`${base}/${form.id}`, { method: 'PUT', auth: true, body: body(form) })
        : await api(base, { method: 'POST', auth: true, body: body(form) });
      upsert(saved);
      setForm(null);
      setMsg({ type: 'ok', text: form.id ? 'Promo actualizada' : 'Promo creada' });
    } catch (err) {
      setMsg({ type: 'alert', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  // Qué pasa cuando coinciden dos promos del mismo tipo: se guarda en el momento
  async function changeMode(value) {
    setMsg(null);
    try {
      await api(`/admin/raffles/${raffleId}`, { method: 'PATCH', auth: true, body: { promoMode: value } });
      if (onModeChange) onModeChange();
      setMsg({ type: 'ok', text: value === 'sum' ? 'Listo: las promos del mismo tipo se suman' : 'Listo: se aplica la mayor de cada tipo' });
    } catch (err) {
      setMsg({ type: 'alert', text: err.message });
    }
  }

  // El interruptor guarda en el momento: prender o apagar una promo no necesita "Guardar"
  async function toggle(p) {
    setMsg(null);
    try {
      upsert(await api(`${base}/${p.id}`, { method: 'PUT', auth: true, body: { enabled: !p.enabled } }));
    } catch (err) {
      setMsg({ type: 'alert', text: err.message });
    }
  }

  async function remove(p) {
    setMsg(null);
    try {
      await api(`${base}/${p.id}`, { method: 'DELETE', auth: true });
      setList((cur) => cur.filter((x) => x.id !== p.id));
      setConfirmDel(null);
      setMsg({ type: 'ok', text: 'Promo eliminada. Las compras que ya la usaron no cambian.' });
    } catch (err) {
      setMsg({ type: 'alert', text: err.message });
    }
  }

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <section className="card mt">
      <div className="row between">
        <h2>Promos y cupones</h2>
        {!form && (
          <div className="row">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setForm({ ...EMPTY, type: 'percent' }); setMsg(null); }}>+ Descuento %</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setForm({ ...EMPTY, type: 'bonus' }); setMsg(null); }}>+ Chances de regalo</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setForm({ ...EMPTY, type: 'percent', useCode: true }); setMsg(null); }}>+ Código</button>
          </div>
        )}
      </div>
      <p className="small muted">
        Cada promo da <strong>una sola cosa</strong> (descuento o chances de regalo), con sus propias fechas, y se prende o apaga con su interruptor.
        Podés tener varias activas a la vez: un descuento y un regalo siempre se combinan. Las promos con código no se muestran en la página:
        solo las usa quien escribe el código.
      </p>
      <label className="small">Si coinciden dos descuentos (o dos regalos) en una compra:{' '}
        <select value={mode} onChange={(e) => changeMode(e.target.value)}>
          <option value="best">Aplicar solo el mayor</option>
          <option value="sum">Sumarlos (el descuento total nunca pasa de 90%)</option>
        </select>
      </label>

      {list.length === 0 && !form && <p className="muted">Todavía no hay promos. Creá la primera con "+ Nueva promo".</p>}

      {list.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Activa</th><th>Promo</th><th>Cómo se usa</th><th>Vigencia</th><th>Usos</th><th>Estado</th><th /></tr></thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id}>
                  <td>
                    <input type="checkbox" checked={p.enabled} onChange={() => toggle(p)} aria-label={`${p.enabled ? 'Apagar' : 'Prender'} ${p.name}`} />
                  </td>
                  <td><strong>{p.name}</strong><br /><span className="small muted">{describe(p)}{p.minChances ? ` · desde ${p.minChances} chances` : ''}</span></td>
                  <td>{p.code ? <>Con el código <code>{p.code}</code></> : 'Automática para todos'}</td>
                  <td className="small">
                    {p.startsAt || p.endsAt
                      ? <>{p.startsAt ? `desde ${dateTime(p.startsAt)}` : ''}{p.startsAt && p.endsAt ? <br /> : ''}{p.endsAt ? `hasta ${dateTime(p.endsAt)}` : ''}</>
                      : <span className="muted">Sin fechas</span>}
                  </td>
                  <td>{p.maxUses ? `${p.used} de ${p.maxUses}` : p.used}</td>
                  <td><span className={`status ${STATE[p.state]?.cls || ''}`}>{STATE[p.state]?.label || p.state}</span></td>
                  <td>
                    <div className="row" style={{ flexWrap: 'nowrap' }}>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setForm({ id: p.id, ...toForm(p) }); setMsg(null); }}>Editar</button>
                      {confirmDel === p.id ? (
                        <>
                          <button type="button" className="btn btn-sm" onClick={() => remove(p)}>Sí, quitar</button>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmDel(null)}>No</button>
                        </>
                      ) : (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmDel(p.id)}>Quitar</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {form && (
        <form className="card mt-sm" onSubmit={save}>
          <h3>{form.id ? 'Editar promo' : form.useCode ? 'Nuevo código' : form.type === 'bonus' ? 'Nueva promo de chances de regalo' : 'Nuevo descuento'}</h3>
          <div className="row">
            <label>Nombre (lo ve el comprador)
              <input required maxLength={80} placeholder="Ej: Black Friday" value={form.name} onChange={(e) => set('name', e.target.value)} />
            </label>
            <label>Qué da
              <select value={form.type} onChange={(e) => set('type', e.target.value)}>
                <option value="percent">Descuento (% menos en el total)</option>
                <option value="bonus">Chances de regalo (más chances, mismo precio)</option>
              </select>
            </label>
          </div>
          {form.type === 'percent' ? (
            <div className="row">
              <label>Descuento (%)
                <input required type="number" min="1" max="90" style={{ width: '7rem' }} value={form.percent} onChange={(e) => set('percent', e.target.value)} />
              </label>
            </div>
          ) : (
            <div className="row">
              <label>Chances de regalo
                <input required type="number" min="1" max="1000" style={{ width: '7rem' }} value={form.bonus} onChange={(e) => set('bonus', e.target.value)} />
              </label>
              <label>por cada (chances compradas)
                <input required type="number" min="1" max="10000" style={{ width: '7rem' }} value={form.bonusEvery} onChange={(e) => set('bonusEvery', e.target.value)} />
              </label>
            </div>
          )}
          <div className="row">
            <label className="check"><input type="checkbox" checked={form.useCode} onChange={(e) => set('useCode', e.target.checked)} /> Con código (si lo apagás, se aplica sola a todos)</label>
            {form.useCode && (
              <label>Código (es solo la palabra que escribe el comprador)
                <input required maxLength={30} placeholder="Ej: ZONA10" value={form.code} onChange={(e) => set('code', e.target.value.toUpperCase())} />
              </label>
            )}
          </div>
          <div className="row">
            <label>Mínimo de chances en la compra (opcional)
              <input type="number" min="0" style={{ width: '8rem' }} value={form.minChances} onChange={(e) => set('minChances', e.target.value)} />
            </label>
            <label>Tope de usos (opcional)
              <input type="number" min="1" style={{ width: '8rem' }} value={form.maxUses} onChange={(e) => set('maxUses', e.target.value)} />
            </label>
          </div>
          <div className="row">
            <label>Empieza (opcional)
              <input type="datetime-local" value={form.startsAt} onChange={(e) => set('startsAt', e.target.value)} />
            </label>
            <label>Termina (opcional)
              <input type="datetime-local" value={form.endsAt} onChange={(e) => set('endsAt', e.target.value)} />
            </label>
            <label className="check"><input type="checkbox" checked={form.enabled} onChange={(e) => set('enabled', e.target.checked)} /> Activa</label>
          </div>
          <p className="small muted">
            {form.type === 'bonus' && form.bonus && form.bonusEvery
              ? `Ejemplo: quien compra ${Number(form.bonusEvery) * 2} chances recibe ${Number(form.bonus) * 2} de regalo; quien compra menos de ${form.bonusEvery}, ninguna. `
              : ''}
            Las fechas son de esta promo. El tope de usos cuenta solo las compras ya pagadas.
          </p>
          <div className="row">
            <button className="btn" disabled={busy}>{busy ? 'Guardando…' : 'Guardar promo'}</button>
            <button type="button" className="btn btn-ghost" onClick={() => setForm(null)}>Cancelar</button>
          </div>
        </form>
      )}

      {msg && <p className={`${msg.type} mt-sm`} role="status">{msg.text}</p>}
    </section>
  );
}
