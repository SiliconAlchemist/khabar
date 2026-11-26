import { networkInterfaces } from 'node:os';
import { createApp } from './server/app.mjs';
import { openDatabase } from './server/database.mjs';

const port = Number(process.env.PORT ?? 4181);
const lan = process.argv.includes('--lan');
const addresses = lan ? Object.values(networkInterfaces()).flat()
  .filter(item => item.family === 'IPv4' && !item.internal).map(item => item.address) : [];
const server = createApp(openDatabase(), { port, addresses });
server.listen(port, lan ? '0.0.0.0' : '127.0.0.1', () => {
  console.log(`Khabar at http://127.0.0.1:${port}/`);
  for (const address of addresses) console.log(`LAN edition: http://${address}:${port}/`);
});
