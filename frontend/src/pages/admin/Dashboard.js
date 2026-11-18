import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApi } from '../../hooks';
import { api, money, setToken } from '../../api';
import { PromoEditor, cleanPromos } from '../../components/Promos';

const statusLabel = { draft: 'Borrador', active: 'A la venta', closed: 'Venta cerrada', drawn: 'Sorteado' };
const empty = { title: '', prize: '', description: '', imageUrl: '', pricePerNumber: '', totalNumbers: '', drawDate: '', youtubeUrl: '', permitNumber: '', terms: '' };

export default function Dashboard() {
  const nav = useNavigate();
  const { data: raffles, reload } = useApi('/admin/raffles', { auth: true });
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState(empty);
  const [promos, setPromos] = useState([{ qty: 2, price: '' }, { qty: 5, price: '' }]);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function create(e) {
    e.preventDefault();
    setError(null);
    try {
      const r = await api('/admin/raffles', {
        method: 'POST',
        auth: true,
        body: {
          ...form,
          pricePerNumber: Number(form.pricePerNumber),
          promos: cleanPromos(promos),
          totalNumbers: Number(form.totalNumbers),
          drawDate: form.drawDate ? new Date(form.drawDate).toISOString() : null,
          status: 'draft',
        },
      });
      setForm(empty);
      setCreating(false);
      reload();
      nav(`/admin/sorteo/${r.id}`);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="container">
      <div className="row between">
        <h1>Sorteos</h1>
        <div className="row">
          <Link to="/admin/cursos" className="btn btn-ghost">Cursos</Link>
          <button className="btn" onClick={() => setCreating(!creating)}>{creating ? 'Cancelar' : '+ Nuevo sorteo'}</button>
          <button className="btn btn-ghost" onClick={() => { setToken(null); nav('/admin/login'); }}>Salir</button>
        </div>
      </div>

      {creating && (
        <form className="card form-grid" onSubmit={create}>
          <label>Título<input required value={form.title} onChange={set('title')} placeholder="Gran Sorteo Edición Premium" /></label>
          <label>Premio<input required value={form.prize} onChange={set('prize')} placeholder="Chevrolet Onix 0km" /></label>
          <label>Precio de 1 número ($)<input required type="number" min="1" value={form.pricePerNumber} onChange={set('pricePerNumber')} /></label>
          <label>Cantidad de números<input required type="number" min="1" max="100000" value={form.totalNumbers} onChange={set('totalNumbers')} /></label>
          <label>Fecha y hora del sorteo<input type="datetime-local" value={form.drawDate} onChange={set('drawDate')} /></label>
          <label>N° de autorización<input value={form.permitNumber} onChange={set('permitNumber')} /></label>
          <label>URL de la imagen del premio<input value={form.imageUrl} onChange={set('imageUrl')} /></label>
          <label>Link del vivo de YouTube<input value={form.youtubeUrl} onChange={set('youtubeUrl')} /></label>
          <div className="full"><label>Promos por cantidad (opcional)</label><PromoEditor value={promos} onChange={setPromos} /><p className="small muted">Ej: 2 números por $15.000, 5 por $30.000. El sistema cobra siempre la combinación más barata.</p></div>
          <label className="full">Descripción<textarea rows="2" value={form.description} onChange={set('description')} /></label>
          <label className="full">Bases y condiciones<textarea rows="5" value={form.terms} onChange={set('terms')} /></label>
          <p className="small muted full">El precio de 1 número y la cantidad de números no se pueden cambiar después (las promos sí). El sorteo se crea como borrador: lo publicás desde su página.</p>
          {error && <p className="alert full">{error}</p>}
          <button className="btn full">Crear sorteo</button>
        </form>
      )}

      <div className="table-wrap">
        <table>
          <thead><tr><th>Sorteo</th><th>Premio</th><th>Precio</th><th>Números</th><th>Estado</th><th /></tr></thead>
          <tbody>
            {(raffles || []).map((r) => (
              <tr key={r.id}>
                <td>{r.title}</td>
                <td>{r.prize}</td>
                <td>{money(r.pricePerNumber)}</td>
                <td>{r.totalNumbers}</td>
                <td><span className={`status s-${r.status}`}>{statusLabel[r.status]}</span></td>
                <td><Link to={`/admin/sorteo/${r.id}`}>Administrar →</Link></td>
              </tr>
            ))}
            {raffles && raffles.length === 0 && <tr><td colSpan="6" className="muted">Todavía no hay sorteos.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
