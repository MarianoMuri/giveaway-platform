import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useApi } from '../hooks';
import { track } from '../analytics';
import { api, money, dateTime, goTo } from '../api';
import brand from '../brand';
import ProvinceSelect from '../components/ProvinceSelect';
import ProfileFields from '../components/ProfileFields';
import CoursePicker from '../components/CoursePicker';
import Countdown from '../components/Countdown';
import Faq from '../components/Faq';

// Página de compra: curso + pack de chances (+ "Duplicá").
// Los totales que se muestran vienen calculados por el backend: acá no se suman precios.
export default function RafflePage() {
  const { id } = useParams();
  const { data: raffle, error } = useApi(`/raffles/${id}`, { interval: 30000 });
  const { data: offer } = useApi(`/raffles/${id}/packs`);
  const { data: courses } = useApi('/courses');

  const [courseId, setCourseId] = useState(null);
  const [packId, setPackId] = useState(null);
  const [double, setDouble] = useState(false);
  const [buyer, setBuyer] = useState({ name: '', dni: '', phone: '', email: '', province: '', locality: '' });
  const [accept, setAccept] = useState(false);
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState(null);
  // Código de promo: el total con código lo calcula el backend (codeQuote); acá no se resta nada
  const [codeInput, setCodeInput] = useState('');
  const [appliedCode, setAppliedCode] = useState(null);
  const [codeQuote, setCodeQuote] = useState(null);
  const [codeMsg, setCodeMsg] = useState(null);
  const coursesRef = useRef(null);
  const packsRef = useRef(null);

  const packs = useMemo(() => offer?.packs || [], [offer]);
  // Arranca con el pack destacado elegido (se puede cambiar)
  useEffect(() => {
    if (packId === null && packs.length) setPackId((packs.find((p) => p.featured) || packs[0]).id);
  }, [packs, packId]);

  // Medición: alguien mira el sorteo (una vez por sorteo)
  const raffleId = raffle?.id;
  const raffleTitle = raffle?.title;
  useEffect(() => {
    if (raffleId) track('ViewContent', { id: raffleId, name: raffleTitle });
  }, [raffleId, raffleTitle]);

  // Con un código aplicado, cada cambio de pack o de "Duplicá" se vuelve a cotizar en el backend.
  // Si el código ya no sirve para esa elección (por ejemplo pide más chances), se avisa y se saca.
  const doubleOn = double;
  useEffect(() => {
    if (!appliedCode || packId === null || !raffleId) return undefined;
    let alive = true;
    const p = packs.find((x) => x.id === packId);
    api(`/raffles/${raffleId}/quote`, { method: 'POST', body: { packId, double: Boolean(doubleOn && p?.double), code: appliedCode } })
      .then((q) => { if (alive) { setCodeQuote(q); setCodeMsg(null); } })
      .catch((err) => { if (alive) { setCodeQuote(null); setAppliedCode(null); setCodeMsg(err.message); } });
    return () => { alive = false; };
  }, [appliedCode, packId, doubleOn, raffleId, packs]);

  if (error) return <div className="container"><p className="alert">Sorteo no encontrado.</p></div>;
  if (!raffle || !offer || !courses) return <div className="container"><p className="muted">Cargando…</p></div>;

  const pack = packs.find((p) => p.id === packId);

  const useDouble = double && pack?.double;
  const baseSel = pack && (useDouble ? pack.double : { chances: pack.chances, total: pack.price, perChance: pack.perChance });
  // Promo automática (la calcula el backend) o la del código aplicado
  const autoFinal = pack && (useDouble ? pack.double.final : pack.final);
  const withCode = appliedCode && codeQuote;
  const selection = withCode ? codeQuote : autoFinal ? { ...baseSel, ...autoFinal } : baseSel;
  const codeLoading = appliedCode && !codeQuote;

  function applyCode(e) {
    if (e) e.preventDefault();
    const c = codeInput.trim();
    if (!c) return;
    setCodeMsg(null);
    setCodeQuote(null);
    setAppliedCode(c);
  }
  function removeCode() {
    setAppliedCode(null);
    setCodeQuote(null);
    setCodeMsg(null);
    setCodeInput('');
  }
  const course = courses.find((c) => c.id === courseId);
  const scrollTo = (ref) => setTimeout(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);

  function pickCourse(c) {
    setCourseId(c.id);
    setMsg(null);
    scrollTo(packsRef);
  }

  async function buy(e) {
    e.preventDefault();
    if (!course) return setMsg('Elegí un curso.');
    if (!pack) return setMsg('Elegí un pack de chances.');
    if (!accept) return setMsg('Tenés que aceptar las bases y condiciones.');
    setSending(true);
    setMsg(null);
    try {
      const res = await api(`/raffles/${raffle.id}/purchases`, {
        method: 'POST',
        body: { courseId: course.id, packId: pack.id, double: Boolean(useDouble), buyer, code: appliedCode || undefined },
      });
      try {
        localStorage.setItem('lastOrder', res.orderId);
      } catch { /* sin storage */ }
      track('InitiateCheckout', { id: raffle.id, name: raffle.title, value: selection?.total, chances: selection?.chances });
      goTo(res.checkoutUrl);
    } catch (err) {
      setMsg(err.message);
      setSending(false);
    }
  }

  return (
    <div className="container buy-page">
      <Link to="/" className="small">← Volver</Link>
      <header className="buy-head">
        <h1 className="mt-sm">{raffle.title}</h1>
        <p className="prize">🚗 {raffle.prize}</p>
        <p className="muted small">Sorteo en vivo · {dateTime(raffle.drawDate)}</p>
      </header>

      {raffle.salesOpen === false || raffle.status !== 'active' ? (
        <p className="alert">{raffle.status === 'active' ? 'La venta de este sorteo ya cerró. ¡Mucha suerte a todos los participantes!' : 'Este sorteo ya no está a la venta.'}</p>
      ) : (
        <>
          <ul className="perks">
            <li>⚡ Números al instante</li>
            <li>📺 Sorteo en vivo</li>
            <li>📘 Curso en tu email</li>
          </ul>
          {raffle.salesCloseAt && (
            <>
              <Countdown until={raffle.salesCloseAt} />
              <p className="small muted center">Cierre: {dateTime(raffle.salesCloseAt)}</p>
            </>
          )}
          <p className="explain">
            Comprás un <strong>curso digital</strong> y te regalamos <strong>chances</strong> para el sorteo.
            Tus números se asignan solos, en orden, apenas se acredita el pago.
          </p>
          <div className="buy-grid">
          <section className="step buy-courses" ref={coursesRef}>
            <h2><span className="step-n">1</span> Elegí tu curso</h2>
            {courses.length > 0 && (
              <p className="small muted course-all">
                <strong>Cursos disponibles ({courses.length}):</strong> {courses.map((c) => c.title).join(' · ')}
              </p>
            )}
            <CoursePicker courses={courses} value={courseId} onPick={pickCourse} />
          </section>

          <section className="step buy-packs" ref={packsRef}>
            <h2><span className="step-n">2</span> Elegí tus chances</h2>
            {offer.promos?.length > 0 && (
              <div className="promo-banner" role="note">
                <p><strong>⚡ ¡Ofertas relámpago! Aprovechalas antes de que se terminen</strong></p>
                {offer.promos.map((pr) => (
                  <p key={pr.name}>
                    {pr.bonus > 0
                      ? <>🎁 <strong>{pr.name}:</strong> ¡te regalamos {pr.bonus} {pr.bonus === 1 ? 'chance' : 'chances'} por cada {pr.bonusEvery} que compres!</>
                      : <>🔥 <strong>{pr.name}:</strong> ¡{pr.percent}% OFF en tu compra!</>}
                    {pr.minChances ? ` Desde ${pr.minChances} chances.` : ''}
                    {pr.endsAt ? <span className="small muted"> Hasta el {dateTime(pr.endsAt)}.</span> : ''}
                    {pr.left !== null && pr.left !== undefined && <strong className="save"> ¡{pr.left === 1 ? 'Queda 1 cupo' : `Quedan ${pr.left} cupos`}!</strong>}
                  </p>
                ))}
              </div>
            )}
            <div className="pack-list" role="radiogroup" aria-label="Packs de chances">
              {packs.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={p.id === packId}
                  className={`pack ${p.id === packId ? 'selected' : ''} ${p.featured ? 'featured' : ''}`}
                  onClick={() => { setPackId(p.id); setMsg(null); }}
                >
                  {p.featured && <span className="pack-tag">El más elegido</span>}
                  <span className="pack-chances"><strong>{p.final ? p.final.chances : p.chances}</strong> chances{p.final?.bonusChances > 0 && <span className="save small"> (+{p.final.bonusChances} de regalo 🎁)</span>}</span>
                  <span className="pack-price">
                    {p.final?.discount > 0 && <s className="pack-was">{money(p.price)}</s>}{' '}
                    {money(p.final ? p.final.total : p.price)}
                  </span>
                  <span className="pack-meta small">
                    {money(p.final ? p.final.perChance : p.perChance)} c/u
                    {p.final ? <span className="save"> · ⚡ {p.final.promo.name}</span> : p.savingsPct && <span className="save"> · {p.savingsPct}% menos por chance</span>}
                  </span>
                </button>
              ))}
            </div>

            {pack?.double && (
              <label className={`double ${double ? 'on' : ''}`}>
                <span className="double-tag">Oferta</span>
                <input type="checkbox" checked={double} onChange={(e) => setDouble(e.target.checked)} />
                <span>
                  <strong>¡Duplicá tus chances!</strong> Sumá {pack.chances} chances más por {money(pack.double.doubleExtra)}
                  <span className="small muted"> → {(pack.double.final || pack.double).chances} chances por {money((pack.double.final || pack.double).total)}</span>
                </span>
              </label>
            )}
          </section>

          <form className="step card checkout buy-form" onSubmit={buy}>
            <h2><span className="step-n">3</span> Tus datos</h2>
            <label>Nombre y apellido<input required autoComplete="name" value={buyer.name} onChange={(e) => setBuyer({ ...buyer, name: e.target.value })} /></label>
            <label>DNI<input required inputMode="numeric" value={buyer.dni} onChange={(e) => setBuyer({ ...buyer, dni: e.target.value.replace(/\D/g, '') })} /></label>
            <ProvinceSelect value={buyer.province} onChange={(province) => setBuyer({ ...buyer, province })} excluded={raffle.excludedProvinces} />
            <label>Celular (WhatsApp)<input required inputMode="tel" autoComplete="tel" value={buyer.phone} onChange={(e) => setBuyer({ ...buyer, phone: e.target.value })} /></label>
            <label>Email (te llega el curso)<input required type="email" autoComplete="email" value={buyer.email} onChange={(e) => setBuyer({ ...buyer, email: e.target.value })} /></label>
            <ProfileFields value={buyer} onChange={setBuyer} />

            <div className="code-box">
              {withCode ? (
                <p className="row between">
                  <span>⚡ Código <strong>{appliedCode.toUpperCase()}</strong> aplicado{codeQuote.applied?.some((x) => x.code) ? `: ${codeQuote.applied.find((x) => x.code).name}` : '. Ya tenés una promo mejor aplicada, así que no suma'}</span>
                  <button type="button" className="linklike small" onClick={removeCode}>Quitar</button>
                </p>
              ) : (
                <div className="row">
                  <label className="grow">¿Tenés un código relámpago? Escribilo y ahorrá
                    <input value={codeInput} autoCapitalize="characters" autoComplete="off" placeholder="Escribilo acá" onChange={(e) => setCodeInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') applyCode(e); }} />
                  </label>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={!codeInput.trim() || codeLoading} onClick={applyCode}>{codeLoading ? 'Verificando…' : 'Aplicar'}</button>
                </div>
              )}
              {codeMsg && <p className="alert small" role="alert">{codeMsg}</p>}
            </div>

            <div className="summary">
              <div className="row between"><span className="muted">Curso</span><span>{course ? course.title : <button type="button" className="linklike" onClick={() => scrollTo(coursesRef)}>Elegir</button>}</span></div>
              <div className="row between"><span className="muted">Chances</span><span>{selection ? selection.chances : '-'}{selection?.bonusChances > 0 && <span className="save small"> (incluye {selection.bonusChances} de regalo)</span>}</span></div>
              <div className="row between"><span className="muted">Precio por chance</span><span>{selection ? money(selection.perChance) : '-'}</span></div>
              {selection?.promo && selection.discount > 0 && (
                <div className="row between"><span className="muted">⚡ Ahorrás ({selection.promo.name})</span><span className="save">- {money(selection.discount)}</span></div>
              )}
              <div className="row between total"><span>Total</span><strong>{selection ? money(selection.total) : '-'}</strong></div>
            </div>

            {brand.location && (
              <p className="small">
                Esta compra se realiza en <strong>{brand.location}</strong>, lugar habilitado para este sorteo{raffle.permitNumber ? <> (autorización N° {raffle.permitNumber})</> : null}.
              </p>
            )}

            <label className="check">
              <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
              <span>Acepto las <Link to={`/sorteo/${raffle.id}/bases`} target="_blank">bases y condiciones</Link> y soy mayor de 18 años.</span>
            </label>

            {msg && <p className="alert">{msg}</p>}
            <button className="btn btn-lg btn-block" disabled={sending}>
              {sending ? 'Redirigiendo a Mercado Pago…' : selection ? `Pagar ${money(selection.total)}` : 'Pagar'}
            </button>
            <p className="small muted center">Pagás en Mercado Pago. Al acreditarse, te mostramos tus números y te llega el curso por email.</p>
          </form>
          </div>
          {raffle.freeEntryEnabled && (
            <p className="free-note">
              <strong>Participar no requiere compra.</strong> Si preferís no comprar, <Link to={`/sorteo/${raffle.id}/participar-gratis`}>participá gratis</Link> con 1 número por DNI.
            </p>
          )}
        </>
      )}
      <Faq raffle={raffle} />
    </div>
  );
}
