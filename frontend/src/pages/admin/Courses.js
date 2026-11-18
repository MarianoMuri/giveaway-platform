import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../../hooks';
import { api } from '../../api';

const empty = { title: '', description: '', coverUrl: '', position: '', active: true };
const sizeMb = (b) => `${(b / 1024 / 1024).toFixed(1)} MB`;

// Arma el FormData: los campos de texto + el PDF si se eligió uno
function toForm(form, file) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(form)) fd.append(k, String(v));
  if (file) fd.append('pdf', file);
  return fd;
}

export default function Courses() {
  const { data: courses, reload } = useApi('/admin/courses', { auth: true });
  const [editing, setEditing] = useState(null); // null = cerrado · 'new' · id del curso
  const [form, setForm] = useState(empty);
  const [file, setFile] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  function open(course) {
    setError(null);
    setFile(null);
    if (!course) {
      setForm(empty);
      setEditing('new');
    } else {
      setForm({ title: course.title, description: course.description || '', coverUrl: course.coverUrl || '', position: course.position, active: course.active });
      setEditing(course.id);
    }
  }

  async function save(e) {
    e.preventDefault();
    setError(null);
    if (editing === 'new' && !file) return setError('Elegí el PDF del curso');
    setBusy(true);
    try {
      const isNew = editing === 'new';
      await api(isNew ? '/admin/courses' : `/admin/courses/${editing}`, { method: isNew ? 'POST' : 'PATCH', auth: true, body: toForm(form, file) });
      setEditing(null);
      reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(c) {
    await api(`/admin/courses/${c.id}`, { method: 'PATCH', auth: true, body: { active: !c.active } });
    reload();
  }

  async function remove(c) {
    if (!window.confirm(`¿Eliminar "${c.title}"? Se borra también el PDF y dejan de funcionar sus links de descarga.`)) return;
    await api(`/admin/courses/${c.id}`, { method: 'DELETE', auth: true });
    reload();
  }

  async function testLink(c) {
    try {
      const { url } = await api(`/admin/courses/${c.id}/download-link`, { method: 'POST', auth: true });
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="container">
      <div className="row between">
        <h1>Cursos</h1>
        <div className="row">
          <Link to="/admin" className="btn btn-ghost">← Sorteos</Link>
          <button className="btn" onClick={() => (editing ? setEditing(null) : open(null))}>{editing ? 'Cancelar' : '+ Nuevo curso'}</button>
        </div>
      </div>
      <p className="muted small">Cada compra incluye un curso. Solo los cursos activos aparecen en la página de compra; desactivar uno no afecta a quienes ya lo compraron.</p>

      {editing && (
        <form className="card form-grid" onSubmit={save}>
          <label>Título<input required value={form.title} onChange={set('title')} placeholder="Cocina básica" /></label>
          <label>Orden<input type="number" min="0" value={form.position} onChange={set('position')} placeholder="1" /></label>
          <label className="full">Descripción<textarea rows="2" value={form.description} onChange={set('description')} /></label>
          <label className="full">URL de la imagen de portada<input value={form.coverUrl} onChange={set('coverUrl')} /></label>
          <label className="full">
            {editing === 'new' ? 'Archivo PDF' : 'Reemplazar PDF (opcional)'}
            <input type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files[0] || null)} />
          </label>
          <label className="check full"><input type="checkbox" checked={form.active} onChange={set('active')} /> Activo (visible en la página de compra)</label>
          {error && <p className="alert full">{error}</p>}
          <button className="btn full" disabled={busy}>{busy ? 'Guardando…' : 'Guardar curso'}</button>
        </form>
      )}
      {!editing && error && <p className="alert">{error}</p>}

      <div className="table-wrap">
        <table>
          <thead><tr><th>#</th><th>Curso</th><th>PDF</th><th>Estado</th><th /></tr></thead>
          <tbody>
            {(courses || []).map((c) => (
              <tr key={c.id}>
                <td>{c.position}</td>
                <td><strong>{c.title}</strong><div className="small muted">{c.description}</div></td>
                <td className="small">{c.pdfName}<div className="muted">{sizeMb(c.pdfSize)}</div></td>
                <td><span className={`status s-${c.active ? 'active' : 'draft'}`}>{c.active ? 'Activo' : 'Inactivo'}</span></td>
                <td><div className="row">
                  <button className="btn btn-ghost btn-sm" onClick={() => open(c)}>Editar</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => toggle(c)}>{c.active ? 'Desactivar' : 'Activar'}</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => testLink(c)}>Probar descarga</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => remove(c)}>Eliminar</button>
                </div></td>
              </tr>
            ))}
            {courses && courses.length === 0 && <tr><td colSpan="5" className="muted">Todavía no hay cursos.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
