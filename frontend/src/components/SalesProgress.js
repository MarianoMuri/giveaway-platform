// Barra de chances vendidas. La meta es opcional y no es un tope: si se supera, la barra queda llena.
export default function SalesProgress({ raffle, compact = false }) {
  const sold = raffle.chancesSold || 0;
  const goal = raffle.chancesGoal;
  const fmt = (n) => n.toLocaleString('es-AR');
  if (!goal) {
    return sold > 0 ? <p className="small muted">{fmt(sold)} chances vendidas</p> : null;
  }
  const pct = Math.min(100, Math.round((sold / goal) * 100));
  return (
    <div className={`sales ${compact ? 'compact' : ''}`}>
      <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin="0" aria-valuemax="100" aria-label="Chances vendidas">
        <div style={{ width: `${pct}%` }} />
      </div>
      <p className="small muted">{pct}% vendido · {fmt(sold)} chances</p>
    </div>
  );
}
