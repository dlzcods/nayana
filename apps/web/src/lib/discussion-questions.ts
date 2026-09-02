import type { ScreeningResult } from './screening-api'

export type DiscussionQuestion = {
  id: string
  question: string
  purpose: string
}

export function discussionQuestionsFor(screening: ScreeningResult) {
  const indication = screening.top_prediction.label.toLowerCase()
  return [
    {
      id: 'clinical-follow-up',
      question: `Pada pemeriksaan langsung, temuan apa yang membantu menilai apakah pola ${indication} ini perlu ditindaklanjuti?`,
      purpose: 'Memahami temuan klinis apa yang membantu dokter menentukan apakah pemeriksaan lanjutan diperlukan.',
    },
    {
      id: 'relevant-examination',
      question: 'Pemeriksaan mata apa yang paling relevan untuk memahami hasil skrining ini lebih lanjut?',
      purpose: 'Mengetahui pemeriksaan yang dapat melengkapi informasi dari satu foto fundus.',
    },
    {
      id: 'care-options',
      question: 'Bila pemeriksaan langsung menemukan kondisi terkait, pilihan pemantauan atau penanganan apa yang biasanya dipertimbangkan?',
      purpose: 'Memahami langkah yang mungkin dibahas setelah pemeriksaan langsung, tanpa menganggap hasil skrining sebagai diagnosis.',
    },
  ]
}
