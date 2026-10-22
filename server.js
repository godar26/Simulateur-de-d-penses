const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT) || 4173;
const mimeTypes = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
};

const server = http.createServer((request, response) => {
    let pathname;
    try {
        pathname = decodeURIComponent(new URL(request.url, `http://${request.headers.host}`).pathname);
    } catch {
        response.writeHead(400).end('Bad request');
        return;
    }

    const filename = path.resolve(root, `.${pathname}`);
    if (filename !== root && !filename.startsWith(`${root}${path.sep}`)) {
        response.writeHead(403).end('Forbidden');
        return;
    }

    const file = pathname === '/' || pathname.endsWith('/')
        ? path.join(filename, 'index.html')
        : filename;
    fs.stat(file, (statError, stats) => {
        if (statError || !stats.isFile()) {
            response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
            return;
        }
        response.writeHead(200, {
            'Cache-Control': 'no-cache',
            'Content-Length': stats.size,
            'Content-Type': mimeTypes[path.extname(file).toLowerCase()] || 'application/octet-stream',
            'X-Content-Type-Options': 'nosniff',
        });
        fs.createReadStream(file).pipe(response);
    });
});

server.listen(port, host, () => {
    console.log(`Clair est disponible sur http://${host}:${port}`);
});
