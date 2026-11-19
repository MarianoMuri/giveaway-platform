import { useEffect, useRef, useState } from 'react';

// Lista desplegable de cursos: sirve igual con 5 o con 50 cursos.
export default function CoursePicker({ courses, value, onPick }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const selected = courses.find((c) => c.id === value);

  // Se cierra al tocar afuera o con Escape
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  if (courses.length === 0) return <p className="muted small">Pronto vas a poder elegir tu curso.</p>;

  return (
    <div className="course-picker" ref={box}>
      <button type="button" className={`course-picker-btn ${selected ? 'selected' : ''}`} onClick={() => setOpen(!open)} aria-haspopup="listbox" aria-expanded={open}>
        <span>
          <span className="course-title">{selected ? selected.title : 'Elegí un curso…'}</span>
          {selected && selected.description && <span className="small muted course-desc">{selected.description}</span>}
        </span>
        <span aria-hidden className="course-caret">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <ul className="course-list" role="listbox">
          {courses.map((c) => (
            <li key={c.id} role="option" aria-selected={c.id === value}>
              <button type="button" className={c.id === value ? 'selected' : ''} onClick={() => { onPick(c); setOpen(false); }}>
                <span className="course-title">{c.title}</span>
                {c.description && <span className="small muted course-desc">{c.description}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
