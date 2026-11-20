import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, setToken } from '../../api';

export default function Login() {
  const nav = useNavigate();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    try {
      const { token, role } = await api('/admin/login', { method: 'POST', body: form });
      setToken(token);
      nav(role === 'live' ? '/admin/en-vivo' : '/admin');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="container narrow">
      <form className="card" onSubmit={submit}>
        <h2>Ingreso administrador</h2>
        <label>Email<input type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
        <label>Contraseña<input type="password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
        {error && <p className="alert">{error}</p>}
        <button className="btn btn-block">Ingresar</button>
      </form>
    </div>
  );
}
