import { motion, useReducedMotion } from 'motion/react'

const screeningUrl = '/screening'

const resultRows = [
  { name: 'Katarak', value: 91 },
  { name: 'Glaukoma', value: 5 },
  { name: 'Retinopati diabetik', value: 3 },
  { name: 'Kategori normal', value: 1 },
]

export function ProductDemo() {
  const prefersReducedMotion = useReducedMotion()

  return (
    <div className="product-frame" aria-label="Contoh hasil skrining">
      <div className="product-frame__body">
        <figure className="fundus-panel">
          <div className="fundus-panel__image">
            <img
              src="/assets/illustrative-fundus.jpg"
              alt="Visual fundus ilustratif untuk mendemonstrasikan tampilan hasil"
              aria-describedby="product-demo-disclaimer"
            />
          </div>
          <figcaption>Visual fundus ilustratif</figcaption>
        </figure>
        <div className="result-panel">
          <p className="result-panel__eyebrow">Indikasi awal</p>
          <h3 className="result-panel__title">Pola paling mirip dengan katarak</h3>

          <motion.div
            className="result-breakdown"
            aria-label="Perbandingan kemiripan pola"
            initial={prefersReducedMotion ? false : 'hidden'}
            whileInView="visible"
            viewport={{ once: true, amount: 0.35 }}
          >
            {resultRows.map((row, index) => (
              <motion.div
                className={`result-row${index === 0 ? ' result-row--primary' : ''}`}
                key={row.name}
                variants={{
                  hidden: { opacity: 0, y: 8 },
                  visible: { opacity: 1, y: 0, transition: { duration: 0.4, delay: index * 0.08 } },
                }}
              >
                <span>{row.name}</span>
                <span className="result-row__track" aria-hidden="true">
                  <motion.i
                    style={{ width: `${row.value}%`, transformOrigin: 'left center' }}
                    variants={{
                      hidden: { scaleX: 0 },
                      visible: {
                        scaleX: 1,
                        transition: { duration: 0.8, delay: 0.12 + index * 0.09, ease: [0.22, 1, 0.36, 1] },
                      },
                    }}
                  />
                </span>
                <strong>{row.value}%</strong>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </div>

      <div className="product-frame__next">
        <div>
          <span>Langkah selanjutnya</span>
          <p>Konsultasikan hasil ini dengan dokter spesialis mata (Sp.M.) untuk pemeriksaan lebih lanjut.</p>
        </div>
        <a className="optic-primary" href={screeningUrl}>
          Mulai skrining
        </a>
      </div>

      <p className="product-frame__foot" id="product-demo-disclaimer">
        Visual fundus hanya contoh, bukan foto fundus asli. Persentase menunjukkan kemiripan pola, bukan tingkat keparahan atau diagnosis medis.
      </p>
    </div>
  )
}
