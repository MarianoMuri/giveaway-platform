import { useState } from 'react';
import { useApi } from '../hooks';
import { api } from '../api';
import { MIN_TERMS_CHARS, missingBeforeOpening } from '../legal';

// Requisitos legales del sorteo: N° de autorización, bases y condiciones y provincias donde no se ofrece.
// El texto lo redacta y aprueba el abogado del cliente; el sistema solo exige que esté cargado antes de vender.
export default function LegalPanel({ raffle, run }) {
  const { data: provinces } = useApi('/provinces');
  const [permit, setPermit] = useState(raffle.permitNumber || '');
  const [terms, setTerms] = useState(raffle.terms || '');
  const [excluded, setExcluded] = useState(raffle.excludedProvinces || []);
  const missing = missingBeforeOpening({ permitNumber: permit, terms });

  const toggle = (code) => setExcluded((list) => (list.includes(code) ? list.filter((c) => c !== code) : [...list, code]));
  const save = (e) => {
    e.preventDefault();
    return run(
      () => api(`/admin/raffles/${raffle.id}`, { method: 'PATCH', auth: true, body: { permitNumber: permit.trim(), terms, excludedProvinces: excluded } }),
      'Requisitos legales guardados'
    );
  };

  return (
    <details className="card legal" open={raffle.status === 'draft' || missingBeforeOpening(raffle).length > 0}>
      <summary><strong>Requisitos legales y provincias</strong>{missing.length > 0 && <span className="alert small"> · Falta cargar {missing.join(' y ')}</span>}</summary>
      <form onSubmit={save} className="mt-sm">
        <label>N° de autorización
          <input value={permit} onChange={(e) => setPermit(e.target.value)} placeholder="Número de expediente o resolución que autoriza el sorteo" />
        </label>
        <label>Bases y condiciones
          <textarea rows="10" value={terms} onChange={(e) => setTerms(e.target.value)} />
        </label>
        <p className="small muted">
          {terms.trim().length} caracteres (mínimo {MIN_TERMS_CHARS}). El texto lo tiene que aprobar el abogado del cliente. Sin autorización y bases cargadas no se puede abrir la venta.
        </p>

        <h3>No ofrecer el sorteo en</h3>
        <p className="small muted">
          Mendoza, Neuquén, Río Negro, Salta, Tierra del Fuego y Jujuy tienen reglas propias para sorteos promocionales (autorización previa, tasas o escribano).
          Formosa suele excluirse por práctica de mercado. Dejalas tildadas hasta que el abogado resuelva el trámite de cada una.
        </p>
        <div className="province-grid">
          {(provinces || []).map((p) => (
            <label key={p.code} className="check">
              <input type="checkbox" checked={excluded.includes(p.code)} onChange={() => toggle(p.code)} />
              <span className="small">{p.name}</span>
            </label>
          ))}
        </div>
        <button className="btn mt">Guardar</button>
      </form>
    </details>
  );
}
