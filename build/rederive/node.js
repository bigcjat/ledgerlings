'use strict';
const WebSocket = require('ws');

/** One XRPL endpoint. Deliberately tiny: no client library, so nothing between us and the node. */
class Node {
  constructor(url, { timeout = 25000 } = {}) {
    this.url = url; this.timeout = timeout; this.id = 0; this.pending = new Map();
  }
  connect() {
    return new Promise((res, rej) => {
      let settled = false;
      this.ws = new WebSocket(this.url, { handshakeTimeout: this.timeout });
      const fail = e => { if (!settled) { settled = true; rej(e); } };
      this.ws.on('message', m => {
        let d; try { d = JSON.parse(m.toString()); } catch { return; }
        const p = this.pending.get(d.id);
        if (p) { this.pending.delete(d.id); p(d); }
      });
      this.ws.on('open',  () => { settled = true; res(this); });
      this.ws.on('error', fail);
      this.ws.on('close', () => fail(new Error('closed')));
      setTimeout(() => fail(new Error('connect timeout')), this.timeout);
    });
  }
  req(cmd) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      const t = setTimeout(() => { this.pending.delete(id); rej(new Error(`timeout: ${cmd.command}`)); }, this.timeout);
      this.pending.set(id, d => {
        clearTimeout(t);
        if (d.status === 'error' || (d.result && d.result.error)) {
          const e = d.error_message || d.error || (d.result && (d.result.error_message || d.result.error));
          return rej(new Error(`${cmd.command}: ${e}`));
        }
        res(d.result);
      });
      this.ws.send(JSON.stringify({ id, ...cmd }));
    });
  }
  close() { try { this.ws.close(); } catch { /* already gone */ } }
}

/** Connect to as many endpoints as will answer. Fails only if fewer than `min` come up. */
async function connectAll(urls, { min = 2, timeout } = {}) {
  const settled = await Promise.allSettled(urls.map(u => new Node(u, { timeout }).connect()));
  const live = [], dead = [];
  settled.forEach((s, i) => s.status === 'fulfilled'
    ? live.push(s.value)
    : dead.push({ url: urls[i], error: String(s.reason && s.reason.message || s.reason) }));
  if (live.length < min) {
    live.forEach(n => n.close());
    throw new Error(`quorum unreachable: ${live.length} of ${urls.length} endpoints answered, need ${min}` +
                    (dead.length ? ` (${dead.map(d => d.url + ': ' + d.error).join('; ')})` : ''));
  }
  return { live, dead };
}

module.exports = { Node, connectAll };
