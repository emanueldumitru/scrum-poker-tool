/**
 * Production static file server. The built client (dist/client) is loaded into memory once,
 * pre-compressed (brotli + gzip) and served by exact path lookup, so path traversal is
 * impossible by construction.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';

interface StaticFile {
  body: Buffer;
  br: Buffer | null;
  gzip: Buffer | null;
  type: string;
  etag: string;
  immutable: boolean;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const COMPRESSIBLE = /^(text\/|application\/(json|manifest\+json)|image\/svg\+xml)/;

export class StaticFiles {
  private readonly files = new Map<string, StaticFile>();

  static load(dir: string): StaticFiles | null {
    if (!fs.existsSync(path.join(dir, 'index.html'))) return null;
    const site = new StaticFiles();
    const walk = (current: string) => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile()) site.add('/' + path.relative(dir, full).split(path.sep).join('/'), fs.readFileSync(full));
      }
    };
    walk(dir);
    return site;
  }

  private add(urlPath: string, body: Buffer): void {
    const type = TYPES[path.extname(urlPath).toLowerCase()] ?? 'application/octet-stream';
    const compress = COMPRESSIBLE.test(type) && body.length > 1024;
    this.files.set(urlPath, {
      body,
      br: compress ? zlib.brotliCompressSync(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }) : null,
      gzip: compress ? zlib.gzipSync(body, { level: 9 }) : null,
      type,
      etag: `"${createHash('sha1').update(body).digest('base64url')}"`,
      // Vite puts content-hashed bundles in /assets: safe to cache forever.
      immutable: urlPath.startsWith('/assets/'),
    });
  }

  /** Serves a file, falling back to index.html for app routes (SPA). */
  serve(req: IncomingMessage, res: ServerResponse, pathname: string): void {
    let file = this.files.get(pathname);
    if (!file) {
      const isAppRoute = !path.extname(pathname);
      if (!isAppRoute) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end('Not found');
        return;
      }
      file = this.files.get('/index.html')!;
    }
    const headers: Record<string, string> = {
      'Content-Type': file.type,
      ETag: file.etag,
      Vary: 'Accept-Encoding',
      'Cache-Control': file.immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    };
    if (req.headers['if-none-match'] === file.etag) {
      res.writeHead(304, headers);
      res.end();
      return;
    }
    const accepts = String(req.headers['accept-encoding'] ?? '');
    let body = file.body;
    if (file.br && /\bbr\b/.test(accepts)) {
      body = file.br;
      headers['Content-Encoding'] = 'br';
    } else if (file.gzip && /\bgzip\b/.test(accepts)) {
      body = file.gzip;
      headers['Content-Encoding'] = 'gzip';
    }
    headers['Content-Length'] = String(body.length);
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  }
}
