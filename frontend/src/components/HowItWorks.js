// "¿Cómo funciona?": 4 pasos en fila (en el celular, uno debajo del otro)
const STEPS = [
  { icon: '📘', title: 'Elegí tu curso y tus chances', text: 'Escogé el curso que más te guste y cuántas chances querés. Más chances, más posibilidades.' },
  { icon: '💳', title: 'Pagá con Mercado Pago', text: 'Con tarjeta, dinero en cuenta o efectivo. El pago es rápido y seguro.' },
  { icon: '⚡', title: 'Recibí tus números', text: 'Apenas se acredita el pago te los mostramos y te los mandamos por email, con tu curso.' },
  { icon: '📺', title: 'Mirá el sorteo en vivo', text: 'Lo hacemos en vivo por nuestras redes. ¡Puede salir tu número!' },
];

export default function HowItWorks() {
  return (
    <section className="how mt-lg">
      <h2>¿Cómo funciona?</h2>
      <p className="muted">Participar lleva menos de un minuto</p>
      <ol className="how-steps">
        {STEPS.map((s, i) => (
          <li key={s.title} className="how-step">
            <span className="how-n" aria-hidden>{i + 1}</span>
            <span className="how-icon" aria-hidden>{s.icon}</span>
            <h3>{s.title}</h3>
            <p>{s.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
