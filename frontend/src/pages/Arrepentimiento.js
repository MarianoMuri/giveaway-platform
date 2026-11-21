import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

// Botón de arrepentimiento (Res. 424/2020): el comprador pide anular su compra con DNI + email.
// La respuesta es siempre la misma, coincidan o no los datos con una compra.
export default function Arrepentimiento() {
  const [form, setForm] = useState({ dni: '', email: '' });
  const [state, setState] = useState(null); // null | 'sending' | 'sent'
  const [error, setError] = useState(null);

  async function send(e) {
    e.preventDefault();
    setError(null);
    setState('sending');
    try {
      await api('/withdrawals', { method: 'POST', body: form });
      setState('sent');
    } catch (err) {
      setError(err.message);
      setState(null);
    }
  }

  return (
    <div className="container narrow">
      <h1 className="mt-sm">Arrepentimiento</h1>
      {state === 'sent' ? (
        <div className="card">
          <h2>Recibimos tu solicitud</h2>
          <p>Si los datos coinciden con una compra, te enviamos la constancia por email y te respondemos por ese medio.</p>
          <Link to="/" className="btn">Volver al inicio</Link>
        </div>
      ) : (
        <form className="card" onSubmit={send}>
          <p className="muted">Ingresá el DNI y el email que usaste en la compra.</p>
          <label>DNI<input required inputMode="numeric" value={form.dni} onChange={(e) => setForm({ ...form, dni: e.target.value.replace(/\D/g, '') })} /></label>
          <label>Email de la compra<input required type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          {error && <p className="alert">{error}</p>}
          <button className="btn" disabled={state === 'sending'}>{state === 'sending' ? 'Enviando…' : 'Enviar solicitud'}</button>
        </form>
      )}
    </div>
  );
}
