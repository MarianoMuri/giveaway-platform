import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link, useLocation } from 'react-router-dom';
import { useApi } from '../hooks';
import { api, money, dateTime, goTo } from '../api';
import { computeTotal } from '../pricing';
import Promos, { promoList } from '../components/Promos';

const PAGE = 500; // números por página de la grilla
const MAX = 50;

export default function RafflePage() {
  const { id } = useParams();
  const { data: raffle, error } = useApi(`/raffles/${id}`);
  const { data: gridData, reload: reloadGrid } = useApi(`/raffles/${id}/numbers`, { interval: 15000 });
  const grid = useMemo(() => gridData?.grid || [], [gridData]);

  const [selected, setSelected] = useState([]);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [buyer, setBuyer] = useState({ name: '', dni: '', phone: '', email: '' });
  const [accept, setAccept] = useState(false);
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState(null);
  const [gridMsg, setGridMsg] = useState(null);
  // Promo elegida: el comprador elige esa cantidad de números y al completar pasa al pago
  const location = useLocation();
  const [target, setTarget] = useState(location.state?.promo || null);
  const gridRef = useRef(null);
  const checkoutRef = useRef(null);
  const prevLen = useRef(0);

  // Al entrar desde una promo de la home, ir directo a la grilla
  useEffect(() => {
    if (target && raffle) setTimeout(() => gridRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(raffle)]);

  // Cuando elige el último número de la promo, lo llevamos al pago
  useEffect(() => {
    if (target && selected.length === target && prevLen.current < target) {
      setTimeout(() => {
        checkoutRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        checkoutRef.current?.querySelector('input')?.focus({ preventScroll: true });
      }, 350);
    }
    prevLen.current = selected.length;
  }, [selected, target]);

  if (error) return <div className="container"><p className="alert">Sorteo no encontrado.</p></div>;
  if (!raffle) return <div className="container"><p className="muted">Cargando…</p></div>;

  const pages = Math.ceil(grid.length / PAGE);
  const free = grid.reduce((a, s) => a + (s === 0 ? 1 : 0), 0);
  const isFree = (n) => grid[n - 1] === 0;

  function toggle(n) {
    setMsg(null);
    setGridMsg(null);
    if (target && !selected.includes(n) && selected.length >= target) {
      setGridMsg(`Ya elegiste tus ${target} números. Tocá uno elegido para cambiarlo.`);
      return;
    }
    setSelected((s) => {
      if (s.includes(n)) return s.filter((x) => x !== n);
      if (!isFree(n)) return s;
      if (s.length >= MAX) {
        setMsg({ type: 'alert', text: `Podés elegir hasta ${MAX} números por compra.` });
        return s;
      }
      return [...s, n].sort((a, b) => a - b);
    });
  }

  function random() {
    const options = [];
    grid.forEach((s, i) => s === 0 && !selected.includes(i + 1) && options.push(i + 1));
    if (!options.length) return;
    toggle(options[Math.floor(Math.random() * options.length)]);
  }

  // Toca una promo: lo llevamos a la grilla para que elija esa cantidad de números
  function pickPromo(qty) {
    setMsg(null);
    setGridMsg(null);
    setTarget(qty);
    setSelected((s) => (s.length > qty ? s.slice(0, qty) : s));
    setTimeout(() => gridRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }

  // Completa al azar los números que faltan de la promo
  function fillRandom(qty) {
    setMsg(null);
    setGridMsg(null);
    setSelected((s) => {
      if (s.length >= qty) return s.slice(0, qty);
      const options = [];
      grid.forEach((st, i) => st === 0 && !s.includes(i + 1) && options.push(i + 1));
      const next = [...s];
      while (next.length < qty && options.length) {
        next.push(options.splice(Math.floor(Math.random() * options.length), 1)[0]);
      }
      return next.sort((a, b) => a - b);
    });
  }

  function goToNumber(e) {
    e.preventDefault();
    const n = Number(search);
    if (n >= 1 && n <= grid.length) {
      setPage(Math.floor((n - 1) / PAGE));
      toggle(n);
      setSearch('');
    }
  }

  async function buy(e) {
    e.preventDefault();
    if (!selected.length) return setMsg({ type: 'alert', text: 'Elegí al menos un número.' });
    if (!accept) return setMsg({ type: 'alert', text: 'Tenés que aceptar las bases y condiciones.' });
    setSending(true);
    setMsg(null);
    try {
      const res = await api('/orders', { method: 'POST', body: { raffleId: raffle.id, numbers: selected, buyer } });
      try {
        localStorage.setItem('lastOrder', res.orderId);
      } catch { /* sin storage */ }
      goTo(res.checkoutUrl);
    } catch (err) {
      if (err.status === 409 && err.body.unavailable) {
        setSelected((s) => s.filter((n) => !err.body.unavailable.includes(n)));
        setMsg({ type: 'alert', text: `Estos números se acaban de reservar: ${err.body.unavailable.join(', ')}. Elegí otros.` });
        reloadGrid();
      } else {
        setMsg({ type: 'alert', text: err.message });
      }
      setSending(false);
    }
  }

  const price = computeTotal(raffle.pricePerNumber, raffle.promos, selected.length);
  // Próxima promo alcanzable (hasta 3 números más) que mejora el precio por número
  const nudge = selected.length
    ? promoList(raffle).find((p) => p.qty > selected.length && p.qty - selected.length <= 3 && p.price / p.qty < price.total / selected.length)
    : null;

  const start = page * PAGE;
  const visible = grid.slice(start, start + PAGE);
  const width = String(grid.length).length;
  const fmt = (n) => String(n).padStart(width, '0');

  return (
    <div className="container">
      <Link to="/" className="small">← Volver</Link>
      <h1 className="mt-sm">{raffle.title}</h1>
      <p className="prize">🚗 {raffle.prize}</p>
      <p className="muted">
        Desde {money(raffle.pricePerNumber)} · Sorteo {dateTime(raffle.drawDate)} · {free.toLocaleString('es-AR')} disponibles
      </p>

      {raffle.status === 'active' && (raffle.promos || []).length > 0 && (
        <>
          <p className="small muted mt">Elegí una promo y después tus números en la grilla:</p>
          <Promos raffle={raffle} onPick={pickPromo} active={target} />
        </>
      )}

      {raffle.status !== 'active' ? (
        <p className="alert">Este sorteo ya no está a la venta.</p>
      ) : (
        <div className="buy-layout">
          <section className="card grid-card" ref={gridRef}>
            {target && (
              <div className={`pick-bar ${selected.length === target ? 'done' : ''}`}>
                <div className="row between">
                  <strong>
                    {selected.length === target
                      ? `¡Listo! Elegiste tus ${target} números`
                      : `Promo ${target} números: elegí ${target - selected.length} más`}
                  </strong>
                  <span className="pick-count">{selected.length}/{target}</span>
                </div>
                <div className="progress"><div style={{ width: `${(selected.length / target) * 100}%` }} /></div>
                <div className="row mt-sm">
                  {selected.length < target ? (
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => fillRandom(target)}>🎲 Completar al azar</button>
                  ) : (
                    <button type="button" className="btn btn-sm" onClick={() => checkoutRef.current?.scrollIntoView({ behavior: 'smooth' })}>Ir a pagar ↓</button>
                  )}
                  <button type="button" className="linklike small" onClick={() => { setTarget(null); setGridMsg(null); }}>Elegir sin promo</button>
                </div>
                {gridMsg && <p className="small alert mt-sm">{gridMsg}</p>}
              </div>
            )}
            <div className="grid-tools">
              <form onSubmit={goToNumber} className="row">
                <input inputMode="numeric" placeholder="Buscar número" value={search} onChange={(e) => setSearch(e.target.value.replace(/\D/g, ''))} />
                <button className="btn btn-sm btn-ghost">Buscar</button>
              </form>
              <button type="button" className="btn btn-sm btn-ghost" onClick={random}>🎲 Al azar</button>
            </div>
            <div className="legend small">
              <span><i className="dot free" /> Libre</span>
              <span><i className="dot sel" /> Tu elección</span>
              <span><i className="dot res" /> Reservado</span>
              <span><i className="dot sold" /> Vendido</span>
            </div>
            <div className="numgrid">
              {visible.map((s, i) => {
                const n = start + i + 1;
                const sel = selected.includes(n);
                const cls = sel ? 'sel' : s === 2 ? 'sold' : s === 1 ? 'res' : 'free';
                return (
                  <button key={n} type="button" className={`num ${cls}`} disabled={!sel && s !== 0} onClick={() => toggle(n)}>
                    {fmt(n)}
                  </button>
                );
              })}
            </div>
            {pages > 1 && (
              <div className="pager">
                {Array.from({ length: pages }, (_, p) => (
                  <button key={p} type="button" className={`btn btn-sm ${p === page ? '' : 'btn-ghost'}`} onClick={() => setPage(p)}>
                    {fmt(p * PAGE + 1)}–{fmt(Math.min((p + 1) * PAGE, grid.length))}
                  </button>
                ))}
              </div>
            )}
          </section>

          <form className="card checkout" onSubmit={buy} ref={checkoutRef}>
            <h3>Tu compra</h3>
            {selected.length ? (
              <div className="chips">
                {selected.map((n) => (
                  <button type="button" key={n} className="chip" onClick={() => toggle(n)} title="Quitar">
                    {fmt(n)} ✕
                  </button>
                ))}
              </div>
            ) : (
              <p className="muted small">Tocá los números que quieras en la grilla.</p>
            )}
            <div className="total">
              <span>{selected.length} número{selected.length === 1 ? '' : 's'}</span>
              <strong>{money(price.total)}</strong>
            </div>
            {price.savings > 0 && (
              <p className="small savings">
                Promo aplicada: {price.packs.map((p) => `${p.count > 1 ? p.count + ' × ' : ''}${p.qty === 1 ? '1 suelto' : p.qty + ' por ' + money(p.price)}`).join(' + ')} · <strong>Ahorrás {money(price.savings)}</strong>
              </p>
            )}
            {target && selected.length < target && (
              <p className="small muted">Te faltan {target - selected.length} número{target - selected.length === 1 ? '' : 's'} para completar la promo de {target}.</p>
            )}
            {!target && nudge && (
              <button type="button" className="nudge" onClick={() => { setTarget(nudge.qty); fillRandom(nudge.qty); }}>
                💡 Sumá {nudge.qty - selected.length} más y llevás {nudge.qty} por {money(nudge.price)}
              </button>
            )}

            <label>Nombre y apellido<input required value={buyer.name} onChange={(e) => setBuyer({ ...buyer, name: e.target.value })} /></label>
            <label>DNI<input required inputMode="numeric" value={buyer.dni} onChange={(e) => setBuyer({ ...buyer, dni: e.target.value.replace(/\D/g, '') })} /></label>
            <label>Celular (WhatsApp)<input required inputMode="tel" value={buyer.phone} onChange={(e) => setBuyer({ ...buyer, phone: e.target.value })} /></label>
            <label>Email<input required type="email" value={buyer.email} onChange={(e) => setBuyer({ ...buyer, email: e.target.value })} /></label>
            <label className="check">
              <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
              <span>Acepto las <Link to={`/sorteo/${raffle.id}/bases`} target="_blank">bases y condiciones</Link> y soy mayor de 18 años.</span>
            </label>

            {msg && <p className={msg.type}>{msg.text}</p>}
            <button className="btn btn-lg btn-block" disabled={sending || !selected.length}>
              {sending ? 'Redirigiendo a Mercado Pago…' : 'Pagar con Mercado Pago'}
            </button>
            <p className="small muted center">Tus números quedan reservados 15 minutos mientras pagás.</p>
          </form>
        </div>
      )}
    </div>
  );
}
