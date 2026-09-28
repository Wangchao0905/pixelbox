'use strict';
/**
 * `request` npm 包的替代实现，专给 miniprogram-ci 用。
 *
 * 背景：出口代理每次 CONNECT servicewechat.com 需要 ~20 秒，而 `request` 库
 * （经 tunnel-agent）每个 API 调用都建一条新隧道，还偶发 "socket hang up"。
 *
 * 本 shim 用 Node 原生 https.Agent（keep-alive 连接池）+ 自定义
 * createConnection（手动 CONNECT 隧道 + TLS）：首个请求付 20 秒建隧道，
 * 之后所有 API 调用（getattr / getrandstr / 上传代码包 / 二维码轮询）复用
 * 同一条隧道，每个 < 1 秒。
 *
 * 实现的接口（miniprogram-ci 实际用到的子集）：
 *   request(options, callback) -> req
 *     options: { url, method, headers, body, qs, json, timeout }
 *     callback: (error, response, body)
 *     req: EventEmitter，支持 .on('response'), .pipe(dest), .abort()
 *     response: Node 原生 IncomingMessage（statusCode / headers / 可读流），
 *               并挂上 .body（Buffer）
 */

const https = require('https');
const net = require('net');
const tls = require('tls');
const { EventEmitter } = require('events');

function proxyParts() {
  const raw =
    process.env.https_proxy ||
    process.env.HTTPS_PROXY ||
    process.env.http_proxy ||
    process.env.HTTP_PROXY;
  if (!raw) throw new Error('no proxy env set');
  const pu = new URL(raw);
  return {
    host: pu.hostname,
    port: +(pu.port || 3128),
    auth:
      'Proxy-Authorization: Basic ' +
      Buffer.from(
        decodeURIComponent(pu.username) + ':' + decodeURIComponent(pu.password)
      ).toString('base64'),
  };
}

const PROXY = proxyParts();

/**
 * 建一条到目标 host:port 的隧道：TCP -> 代理 -> CONNECT -> TLS。
 * 给 https.Agent 当 createConnection 用，Agent 负责连接池复用。
 */
function createTunnelConnection(options, oncreate) {
  const targetHost = options.hostname || options.host;
  const targetPort = options.port || 443;

  const sock = net.connect(PROXY.port, PROXY.host);
  let settled = false;
  const done = (err, tlsSock) => {
    if (settled) return;
    settled = true;
    if (err) {
      try { sock.destroy(); } catch (_) { /* ignore */ }
      oncreate(err);
    } else {
      oncreate(null, tlsSock);
    }
  };

  const timer = setTimeout(() => done(new Error('tunnel connect timeout')), 90000);
  const cleanup = () => clearTimeout(timer);

  sock.on('connect', () => {
    sock.write(
      `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\n` +
        `Host: ${targetHost}:${targetPort}\r\n` +
        `${PROXY.auth}\r\n` +
        `\r\n`
    );
  });

  let buf = '';
  const onData = (d) => {
    buf += d.toString('latin1');
    if (!buf.includes('\r\n\r\n')) return;
    sock.removeListener('data', onData);
    const statusLine = buf.split('\r\n')[0];
    if (!/^HTTP\/1\.[01] 200/.test(statusLine)) {
      cleanup();
      done(new Error('proxy CONNECT failed: ' + statusLine));
      return;
    }
    // 隧道已建，在上面做 TLS 握手（SNI 指向真实目标）
    const tlsSock = tls.connect(
      {
        socket: sock,
        servername: targetHost,
        // NODE_EXTRA_CA_CERTS 已包含出口 CA，默认校验即可
      },
      () => {
        cleanup();
        done(null, tlsSock);
      }
    );
    tlsSock.on('error', (e) => {
      cleanup();
      done(e);
    });
  };
  sock.on('data', onData);
  sock.on('error', (e) => {
    cleanup();
    done(e);
  });
  // 90s 内没连上就放弃（代理偶发 20s+，留足余量）
}

let sharedAgent = null;
function getAgent() {
  if (!sharedAgent) {
    sharedAgent = new https.Agent({
      keepAlive: true,
      keepAliveMsecs: 30000,
      maxSockets: 10,
      maxFreeSockets: 5,
      // 注意：不要设 Agent 级 timeout，testSourceURL 是长轮询（等微信生成二维码），
      // 60s 会把它掐掉。隧道建立另有 90s 独立超时。
    });
    // 注意：Node 24 里 createConnection 不能当构造参数传，必须直接赋值
    sharedAgent.createConnection = createTunnelConnection;
  }
  return sharedAgent;
}

function buildUrl(options) {
  let u = typeof options === 'string' ? options : options.url || options.uri;
  if (options.qs && typeof options.qs === 'object') {
    const qs = new URLSearchParams(options.qs).toString();
    if (qs) u += (u.includes('?') ? '&' : '?') + qs;
  }
  return u;
}

function buildBody(options) {
  let body = options.body;
  const headers = Object.assign({}, options.headers);
  if (
    options.json &&
    body !== undefined &&
    typeof body !== 'string' &&
    !Buffer.isBuffer(body)
  ) {
    body = JSON.stringify(body);
    if (!headers['content-type'] && !headers['Content-Type'])
      headers['content-type'] = 'application/json';
  }
  let buf = null;
  if (body !== undefined && body !== null) {
    buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
    if (!headers['content-length'] && !headers['Content-Length']) {
      headers['content-length'] = String(buf.length);
    }
  }
  return { buf, headers };
}

class ShimRequest extends EventEmitter {
  constructor(options, callback) {
    super();
    this._options =
      typeof options === 'string' ? { url: options } : Object.assign({}, options);
    this._callback = typeof callback === 'function' ? callback : null;
    this._calledBack = false;
    this._req = null;
    this._response = null;
    this._aborted = false;
  }

  _done(err, resp, body) {
    if (this._calledBack) return;
    this._calledBack = true;
    if (this._callback) {
      try {
        this._callback(err, resp, body);
      } catch (_) {
        /* 回调抛错不向上传播 */
      }
    } else if (err) {
      this.emit('error', err);
    }
  }

  _start() {
    if (this._aborted) return;
    const options = this._options;
    let urlStr;
    try {
      urlStr = buildUrl(options);
    } catch (e) {
      this._done(e);
      return;
    }
    const u = new URL(urlStr);
    const { buf, headers } = buildBody(options);
    if (process.env.SHIM_DEBUG === '1') {
      console.log('[SHIM-DEBUG]', options.method || 'GET', u.pathname, 'timeout=', options.timeout, 'hasBody=', !!buf);
    }

    const reqOpts = {
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      method: (options.method || 'GET').toUpperCase(),
      headers,
      agent: getAgent(),
      // 让 Agent 的 createConnection 能拿到 servername
      servername: u.hostname,
    };

    let req;
    try {
      req = https.request(reqOpts, (res) => {
        this._response = res;
        this.emit('response', res);
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks);
          res.body = body; // 对齐 request 库的 response.body
          this._done(null, res, body);
        });
        res.on('error', (e) => this._done(e));
      });
    } catch (e) {
      this._done(e);
      return;
    }

    if (options.timeout) req.setTimeout(options.timeout);
    req.on('timeout', () => {
      req.destroy(new Error('shim request timeout'));
    });
    req.on('error', (e) => {
      this._done(e);
      // 避免无监听时的 unhandled 'error'
      if (this.listenerCount('error') > 0) this.emit('error', e);
    });

    this._req = req;
    if (buf) req.write(buf);
    req.end();
  }

  abort() {
    this._aborted = true;
    if (this._req) this._req.destroy();
    this._done(new Error('aborted'));
  }

  pipe(dest) {
    if (this._response) return this._response.pipe(dest);
    this.once('response', (res) => res.pipe(dest));
    return dest;
  }
}

function shimRequest(options, callback) {
  const r = new ShimRequest(options, callback);
  // 对齐 request 库：异步发起
  process.nextTick(() => r._start());
  return r;
}

// 兼容可能用到的快捷方法
for (const m of ['get', 'post', 'put', 'del', 'delete', 'head', 'patch']) {
  shimRequest[m] = (options, callback) => {
    if (typeof options === 'string') options = { url: options };
    else options = Object.assign({}, options);
    options.method = m === 'del' ? 'DELETE' : m.toUpperCase();
    return shimRequest(options, callback);
  };
}
shimRequest.defaults = () => shimRequest;
shimRequest.jar = () => ({});
shimRequest.cookie = () => null;

module.exports = shimRequest;

/** 在 require.cache 里把 `request` 换成 shim，必须在 miniprogram-ci 加载前调用 */
module.exports.install = function install() {
  const Module = require('module');
  const path = require('path');
  const base = path.join(__dirname, '..', 'node_modules');
  const targets = new Set([
    path.join(base, 'request', 'request.js'),
    path.join(base, 'request', 'index.js'),
  ]);
  try {
    targets.add(
      require.resolve('request', {
        paths: [path.join(base, 'miniprogram-ci', 'dist', 'utils')],
      })
    );
  } catch (_) {
    /* ignore */
  }
  for (const p of targets) {
    const m = new Module(p, null);
    m.filename = p;
    m.paths = Module._nodeModulePaths(path.dirname(p));
    m.exports = shimRequest;
    m.loaded = true;
    require.cache[p] = m;
  }
};
