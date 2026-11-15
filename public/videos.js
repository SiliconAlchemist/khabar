export const videos = [
  {
    id: 'JlCH7c5k4oY',
    format: 'full',
    explainer: true,
    title: 'How Geography Made California Ridiculously OP',
    publisher: 'The Infographics Show',
    durationSeconds: 1070,
  },
  {
    id: '2uJhjqBz5Tk',
    format: 'full',
    explainer: true,
    title: 'Chernobyl Nuclear Explosion Disaster Explained (Hour by Hour)',
    publisher: 'The Infographics Show',
  },
  {
    id: 'gAkwW2tuIqE',
    format: 'full',
    explainer: true,
    title: "Learn Docker in 7 Easy Steps - Full Beginner's Tutorial",
    publisher: 'Fireship',
    storyId: 'explainer-fireship-docker',
  },
  {
    id: '9kRgVxULbag',
    format: 'full',
    explainer: true,
    title: "Firebase - Ultimate Beginner's Guide",
    publisher: 'Fireship',
  },
  {
    id: 'pjNnDQgAvOw',
    format: 'full',
    explainer: true,
    title: 'Paraguay’s Banking Disaster',
    publisher: 'ColdFusion',
    durationSeconds: 984,
  },
  {
    id: 'Sb1_j9A25nQ',
    format: 'full',
    explainer: true,
    title: 'Why Apple Seems Confused',
    publisher: 'ColdFusion',
    durationSeconds: 744,
  },
  {
    id: 'FsEbLPqeo7k',
    format: 'full',
    explainer: true,
    title: 'The Man Who Refused to be a Trillionaire',
    publisher: 'ColdFusion',
    durationSeconds: 1540,
  },
  {
    id: 'UF63eFJmbrQ',
    format: 'full',
    explainer: true,
    title: 'This Spillway Failed On Purpose',
    publisher: 'Practical Engineering',
    storyId: 'explainer-practical-spillway',
  },
  {
    id: '3YvwqMDDb3k',
    format: 'full',
    explainer: true,
    title: 'Why Roads Get Washboards',
    publisher: 'Practical Engineering',
    storyId: 'explainer-practical-washboards',
  },
  {
    id: 'NmhDcZHg7ik',
    format: 'full',
    explainer: true,
    title: 'The Logistics of Fruit',
    publisher: 'Wendover Productions',
  },
  {
    id: '51J64j1Zdec',
    format: 'shorts',
    title: 'A visit to Delhi’s Jahangirpuri AQI station',
    publisher: 'Peek TV',
    summary: 'Peek TV visits a monitoring station amid questions about how Delhi’s air-quality readings are collected.',
    storyId: 'delhi-air-quality',
  },
  { id: 'PCPoxBLi2TA', format: 'shorts', title: 'Shared YouTube Short 1' },
  { id: '9kf3oIu85XI', format: 'shorts', title: 'Shared YouTube Short 2' },
  { id: 'cQKbRijR8cU', format: 'shorts', title: 'Shared YouTube Short 3' },
  {
    id: 'EKg5Hrkt9Gw',
    format: 'full',
    title: 'Samdish interviews Saurabh Bharadwaj',
    publisher: 'Unfiltered by Samdish',
    summary: 'A 2024 interview about Delhi’s air pollution, municipal government, and efforts to clean the Yamuna.',
    storyId: 'yamuna-water-quality',
  },
  { id: '2hiwvg4ccZg', format: 'full', title: 'Shared YouTube video' },
];

export function youtubeUrl(video) {
  if (video.format === 'shorts') return `https://www.youtube.com/shorts/${video.id}`;
  return `https://www.youtube.com/watch?v=${video.id}`;
}

export function youtubeIdFromUrl(url) {
  const { hostname, pathname, searchParams } = new URL(url);
  if (hostname === 'youtu.be') return pathname.split('/')[1];
  if (!['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(hostname)) return null;
  if (pathname === '/watch') return searchParams.get('v');
  if (pathname.startsWith('/shorts/')) return pathname.split('/')[2];
  return null;
}
