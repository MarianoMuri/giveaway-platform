// "¿Cómo funciona?": camino de 5 pasos (en el celular, uno debajo del otro)
const I = (children) => (
  <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{children}</svg>
);
const STEPS = [
  { title: 'Elegí tu curso', sub: 'Escogé el que más te guste y cuántas chances querés llevarte. Con más chances, más posibilidades.', icon: I(<><path d="M15 5v2M15 11v2M15 17v2" /><path d="M5 5h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4V7a2 2 0 0 1 2-2z" /></>) },
  { title: 'Realizá el pago', sub: 'Pagá rápido y seguro con Mercado Pago: con tarjeta, dinero en cuenta o efectivo.', icon: I(<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M7 15h3" /></>) },
  { title: 'Recibí tus números', sub: 'Apenas se acredita el pago los ves en pantalla y te llegan por email. Cada uno es único.', icon: I(<path d="M5 9h14M5 15h14M11 4 9 20M15 4l-2 16" />) },
  { title: 'Recibí tu curso', sub: 'También te lo enviamos a tu email, para que empieces a aprender cuando quieras.', icon: I(<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>) },
  { title: 'Mirá el sorteo', sub: 'Elegimos al ganador en vivo por nuestras redes. ¡Puede salir tu número!', icon: I(<><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m10 9 5 3-5 3z" /></>), last: true },
];

export default function HowItWorks() {
  return (
    <section className="how mt-lg">
      <h2>¿Cómo funciona?</h2>
      <p className="muted">Participar es fácil: seguí el camino hasta el sorteo</p>
      <div className="how-path">
        <svg className="how-line" viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden>
          <path d="M100 73 C200 73,200 27,300 27 C400 27,400 73,500 73 C600 73,600 27,700 27 C800 27,800 73,900 73" vectorEffect="non-scaling-stroke" />
        </svg>
        <ol className="how-steps">
          {STEPS.map((s) => (
            <li key={s.title} className={`how-step${s.last ? ' last' : ''}`}>
              <span className="how-node">{s.icon}</span>
              <h3>{s.title}</h3>
              <p>{s.sub}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
