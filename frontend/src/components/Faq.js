import { Link } from 'react-router-dom';

// Preguntas frecuentes al pie del sorteo. Lo de participar gratis solo aparece si está habilitado.
export default function Faq({ raffle }) {
  // En la portada puede no haber un sorteo abierto: entonces no se muestran los links que dependen de uno
  const free = Boolean(raffle?.freeEntryEnabled);
  const items = [
    ['¿Cómo recibo mis números?', 'Apenas Mercado Pago confirma el pago, el sistema te asigna los números solo y te los mostramos en pantalla. También te llegan por email junto con el curso.'],
    ['¿Dónde veo mis números después?', <>Entrá a <Link to="/mis-numeros">Mis números</Link> con tu DNI: ahí están todos los que tenés.</>],
    ['¿Puedo elegir mis números?', 'No. Se asignan automáticamente y en orden, para que todos tengan las mismas posibilidades.'],
    ['¿Cuándo y cómo es el sorteo?', 'Se hace en vivo por nuestras redes, a la vista de todos, en la fecha y hora publicadas en el sorteo. Así ves el resultado en el mismo momento en que se define.'],
    ['¿Cómo me entero si gané?', 'Te avisamos por email y por teléfono con los datos que cargaste al comprar. Por eso es importante que estén bien.'],
    ['¿Qué pasa si mi pago se rechaza?', 'No se te cobra ni se asignan números. Podés volver a intentar con otro medio de pago.'],
    ...(free ? [['¿Puedo participar sin comprar?', <>Sí. Tenés 1 número gratis por DNI: <Link to={`/sorteo/${raffle.id}/participar-gratis`}>participá acá</Link>.</>]] : []),
    ['¿Tengo un problema con mi compra, qué hago?', 'Escribinos por cualquiera de nuestras redes y lo resolvemos. Dejanos tu DNI, email y teléfono, y contanos qué pasó.'],
    ['¿Quiénes pueden participar?', 'Mayores de 18 años con DNI argentino. Los detalles están en las bases y condiciones de cada sorteo.'],
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
      {raffle && <p className="small muted"><Link to={`/sorteo/${raffle.id}/bases`}>Leer las bases y condiciones completas</Link></p>}
    </section>
  );
}
