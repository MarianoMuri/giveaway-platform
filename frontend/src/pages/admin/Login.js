import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setToken, ApiError } from '../../api';

export default function Login() {
  const nav = useNavigate();
  const [form, setForm] = useState({ email: '', password: '', code: '' });
  const [needsCode, setNeedsCode] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    try {
      const { token, role } = await api('/admin/login', { method: 'POST', body: form });
      setToken(token);
      nav(role === 'live' ? '/admin/en-vivo' : '/admin');
    } catch (err) {
      if (err instanceof ApiError && err.body?.needsCode) setNeedsCode(true); // pide el código de la app de autenticación
      setError(err.message);
    }
  }

  return (
    <div className="container narrow">
      <form className="card" onSubmit={submit}>
        <h2>Ingreso administrador</h2>
        <label>Usuario<input type="text" required autoCapitalize="none" autoComplete="username" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
        <label>Contraseña<input type="password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
        {needsCode && (
          <label>Código de tu app de autenticación
            <input type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required autoFocus placeholder="6 números" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          </label>
        )}
        {error && <p className="alert">{error}</p>}
        <button className="btn btn-block">Ingresar</button>
      </form>
    </div>
  );
}
