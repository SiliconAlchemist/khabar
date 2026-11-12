export const videos = [
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
