// Preloaded with --import: any network use in this process throws and is recorded.
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
const boom = (what) => () => { process.stderr.write(`NETWORK USED: ${what}\n`); process.exitCode = 99; throw new Error(`network used: ${what}`); };
globalThis.fetch = boom('fetch');
net.connect = net.createConnection = boom('net.connect');
net.Socket.prototype.connect = boom('net.Socket.connect');
tls.connect = boom('tls.connect');
http.request = http.get = boom('http.request');
https.request = https.get = boom('https.request');
dns.lookup = dns.resolve = boom('dns');
dns.promises.lookup = dns.promises.resolve = boom('dns.promises');
