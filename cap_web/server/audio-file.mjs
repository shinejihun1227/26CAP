import fs from 'node:fs';

// Safari may probe the first two bytes before it loads the rest of an MP3.
export function serveAudioFile(request, response, target, size) {
  const headers = { 'content-type': 'audio/mpeg', 'cache-control': 'no-cache', 'accept-ranges': 'bytes' };
  let start = 0, end = size - 1, status = 200;
  const range = request.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
  if (range) {
    start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if ((!range[1] && !range[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end)
      || start > end || start >= size) {
      response.writeHead(416, { ...headers, 'content-range': `bytes */${size}`, 'content-length': '0' });
      response.end();
      return;
    }
    status = 206;
    headers['content-range'] = `bytes ${start}-${end}/${size}`;
  }
  headers['content-length'] = String(end - start + 1);
  response.writeHead(status, headers);
  if (request.method === 'HEAD') { response.end(); return; }
  const stream = fs.createReadStream(target, { start, end });
  stream.on('error', () => response.destroy());
  response.on('close', () => stream.destroy());
  stream.pipe(response);
}
