export const stories = [
  {
    id: 'yamuna-water-quality',
    topic: 'Environment',
    title: 'What the Yamuna’s water tests can tell us',
    summary: 'A guide to reading Delhi’s monthly water samples, from Palla to Okhla Barrage.',
    context: 'Delhi’s pollution control committee publishes water samples by location. Compare the same site across multiple sampling dates to see how readings vary over time. A sample describes the conditions at one place and time.',
    question: 'How do readings change at the same sites before and after the monsoon?',
    image: {
      url: 'https://upload.wikimedia.org/wikipedia/commons/b/b9/Signaturebridgenedelhi.png',
      alt: 'Delhi’s Signature Bridge during construction over the Yamuna',
      credit: 'ThommenJose / Wikimedia Commons',
      page: 'https://commons.wikimedia.org/wiki/File:Signaturebridgenedelhi.png',
      license: 'https://creativecommons.org/licenses/by-sa/4.0/',
    },
    sources: [
      { type: 'Primary evidence', publisher: 'Delhi Pollution Control Committee', title: 'Monthly water analysis reports', url: 'https://dpcc.delhi.gov.in/dpcc/analysis-reports' },
      { type: 'Primary evidence', publisher: 'Delhi Pollution Control Committee', title: 'Yamuna rejuvenation progress reports', url: 'https://dpcc.delhi.gov.in/dpcc/reports-and-publications' },
      { type: 'Independent reporting', publisher: 'The Indian Express', title: 'Coverage of the January and February 2026 water samples', url: 'https://indianexpress.com/article/cities/delhi/yamuna-water-polluted-delhi-dpcc-data-faecal-coliform-levels-10573944/' },
    ],
  },
  {
    id: 'metro-phase-four',
    topic: 'Transport',
    title: 'Where to track Delhi Metro’s Phase IV',
    summary: 'Start with the project map and check the official network before planning a trip.',
    context: 'The Delhi Metro Rail Corporation’s Phase IV project page links to a map of the expansion. Use the official journey planner for trips you intend to take now.',
    question: 'Which interchange stations would change your regular commute once they open?',
    sources: [
      { type: 'Primary evidence', publisher: 'Delhi Metro Rail Corporation', title: 'Phase IV project and map', url: 'https://delhimetrorail.com/pages/en/phase-iv' },
      { type: 'Official service', publisher: 'Delhi Metro Rail Corporation', title: 'Delhi Metro journey planner', url: 'https://delhimetrorail.com/' },
    ],
  },
  {
    id: 'delhi-air-quality',
    topic: 'Environment',
    title: 'How to look up air quality near you',
    summary: 'Find your nearest monitoring station and see how its readings compare with the regional average.',
    context: 'The Central Pollution Control Board provides station-level air quality data for Delhi NCR. Choose a nearby station and check the timestamp when comparing readings.',
    question: 'How much do readings vary between the monitoring stations nearest to you?',
    sources: [
      { type: 'Primary evidence', publisher: 'Central Pollution Control Board', title: 'Delhi NCR air quality dashboard', url: 'https://www.airquality.cpcb.gov.in/AQI/' },
      { type: 'Official reference', publisher: 'Central Pollution Control Board', title: 'National Air Quality Index', url: 'https://airquality.cpcb.gov.in/AQI_India/' },
      { type: 'Related reporting', publisher: 'Peek TV', title: 'Delhi’s missing air-quality monitor readings', url: 'https://newsletter.peektv.in/your-peek-into-the-day-5-stories-that-deserve-the-front-page-53/' },
    ],
  },
];
