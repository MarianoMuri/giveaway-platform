import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApi } from '../hooks';
import { api, DEMO } from '../api';
import Turnstile from '../components/Turnstile';
import ProvinceSelect from '../components/ProvinceSelect';
import ProfileFields from '../components/ProfileFields';

// Identificador anónimo del navegador: ayuda a limitar abusos (no reemplaza al DNI ni al captcha)
function deviceId() {
  try {
    let id = localStorage.getItem('deviceId');
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem('deviceId', id);
    }
    return id;
  } catch {
    return `sin-storage-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  }
}

// Participación gratuita "sin obligación de compra": 1 número por DNI, se asigna al confirmar el email
export default function FreeEntry() {
  const { id } = useParams();
  const { data: raffle, error } = useApi(`/raffles/${id}`);
  const [form, setForm] = useState({ name: '', dni: '', email: '', phone: '', province: '', locality: '' });
  const [accept, setAccept] = useState(false);
  const [captchaToken, setCaptchaToken] = useState(null);
  const [state, setState] = useState(null); // null | 'sending' | 'sent'
  const [demoToken, setDemoToken] = useState(null);
  const [msg, setMsg] = useState(null);
  const onToken = useCallback((t) => setCaptchaToken(t), []);
  useEffect(() => { window.scrollTo(0, 0); }, []);

  if (error) return <div className="container"><p className="alert">Sorteo no encontrado.</p></div>;
  if (!raffle) return <div className="container"><p className="muted">Cargando…</p></div>;

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    if (!accept) return setMsg('Tenés que aceptar las bases y condiciones.');
    setState('sending');
    setMsg(null);
    try {
      const res = await api(`/raffles/${raffle.id}/free-entries`, { method: 'POST', body: { ...form, captchaToken, deviceId: deviceId() } });
      setDemoToken(res.demoToken || null);
      setState('sent');
    } catch (err) {
      setMsg(err.message);
      setState(null);
    }
  }

  const closed = raffle.status !== 'active' || raffle.salesOpen === false || !raffle.freeEntryEnabled;

  return (
    <div className="container narrow">
      <Link to={`/sorteo/${raffle.id}`} className="small">← Volver al sorteo</Link>
      <h1 className="mt-sm">Participá gratis</h1>
      <p className="muted">{raffle.title} · {raffle.prize}</p>

      {closed ? (
        <p className="alert">La participación gratuita no está disponible para este sorteo.</p>
      ) : state === 'sent' ? (
        <div className="ok">
          <strong>¡Casi listo!</strong> Te enviamos un email a <strong>{form.email}</strong>. Abrí el link para confirmar y recibir tu número.
          <div className="small mt-sm">Revisá también la carpeta de spam. El link vence en 24 horas.</div>
          {DEMO && demoToken && (
            <div className="mt-sm"><Link className="btn btn-sm" to={`/participar-gratis/confirmar?token=${demoToken}`}>Abrir el link del email (demo)</Link></div>
          )}
        </div>
      ) : (
        <form className="card" onSubmit={submit}>
          <p className="explain">
            Participar <strong>no requiere comprar nada</strong>. Recibís <strong>1 número</strong> por DNI, con las mismas
            posibilidades que cualquier otro. Tu número se asigna cuando confirmás tu email.
          </p>
          <label>Nombre y apellido<input required autoComplete="name" value={form.name} onChange={set('name')} /></label>
          <label>DNI<input required inputMode="numeric" autoComplete="off" placeholder="Solo números" value={form.dni} onChange={set('dni')} /></label>
          <label>Email<input required type="email" autoComplete="email" inputMode="email" value={form.email} onChange={set('email')} /></label>
          <label>Celular (WhatsApp)<input required inputMode="tel" autoComplete="tel" value={form.phone} onChange={set('phone')} /></label>
          <ProvinceSelect value={form.province} onChange={(province) => setForm({ ...form, province })} excluded={raffle.excludedProvinces} />
          <ProfileFields value={form} onChange={setForm} />
          <Turnstile onToken={onToken} />
          <label className="check mt-sm">
            <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
            <span className="small">Soy mayor de 18 años y acepto las <Link to={`/sorteo/${raffle.id}/bases`}>bases y condiciones</Link>. Usan mis datos para este sorteo y, sin identificarme, para estadísticas.</span>
          </label>
          {msg && <p className="alert small mt-sm">{msg}</p>}
          <button className="btn btn-lg btn-block mt" disabled={state === 'sending'}>{state === 'sending' ? 'Enviando…' : 'Quiero mi número gratis'}</button>
        </form>
      )}
    </div>
  );
}
