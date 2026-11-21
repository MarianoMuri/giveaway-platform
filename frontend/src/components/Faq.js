import { Link } from 'react-router-dom';

// Preguntas frecuentes al pie del sorteo. Lo de participar gratis solo aparece si está habilitado.
export default function Faq({ raffle }) {
  const items = [
    ['¿Cómo recibo mis números?', 'Apenas Mercado Pago confirma el pago, el sistema te asigna los números solo y te los mostramos en pantalla. También te llegan por email junto con el curso.'],
    ['¿Dónde veo mis números después?', <>Entrá a <Link to="/mis-compras">Mis números</Link> con tu DNI: ahí están todos los que tenés.</>],
    ['¿Puedo elegir mis números?', 'No. Se asignan automáticamente y en orden, para que todos tengan las mismas posibilidades.'],
    ['¿Cuándo y cómo es el sorteo?', 'En vivo por YouTube, en la fecha y hora que figuran arriba. Cualquiera lo puede mirar.'],
    ['¿Cómo me entero si gané?', 'Te avisamos por email y por teléfono con los datos que cargaste al comprar. Por eso es importante que estén bien.'],
    ['¿Qué pasa si mi pago se rechaza?', 'No se te cobra ni se asignan números. Podés volver a intentar con otro medio de pago.'],
    ['¿Puedo arrepentirme de la compra?', 'Sí. Tenés 10 días corridos para usar el botón de arrepentimiento, según la ley. Si se anula la compra, se anulan también sus chances.'],
    ...(raffle.freeEntryEnabled ? [['¿Puedo participar sin comprar?', <>Sí. Tenés 1 número gratis por DNI: <Link to={`/sorteo/${raffle.id}/participar-gratis`}>participá acá</Link>.</>]] : []),
    ['¿Quiénes pueden participar?', 'Mayores de 18 años con DNI argentino. Mirá todos los detalles en las bases y condiciones.'],
  ];
  return (
    <section className="faq">
      <h2>Preguntas frecuentes</h2>
      {items.map(([q, a]) => (
        <details key={q}>
          <summary>{q}</summary>
          <p>{a}</p>
        </details>
      ))}
      <p className="small muted"><Link to={`/sorteo/${raffle.id}/bases`}>Leer las bases y condiciones completas</Link></p>
    </section>
  );
}
