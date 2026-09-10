import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import http2 from 'node:http2';
import { syncBuiltinESMExports } from 'node:module';

if (process.versions.node.split('.')[0] !== '20') throw new Error('NODE_20_REQUIRED');
if (Object.keys(process.env).some(k => /DATABASE|OPENAI|RUNPOD|AWS|S3_|SECRET|TOKEN|VERCEL|PRODUCTION|DOTENV/i.test(k))) throw new Error('INHERITED_PROVIDER_ENV_FORBIDDEN');
const forbidden = () => { throw new Error('OFFLINE_NETWORK_FORBIDDEN'); };
http.request = http.get = https.request = https.get = net.connect = net.createConnection = tls.connect = http2.connect = forbidden;
net.Socket.prototype.connect = forbidden;
globalThis.fetch = forbidden;
syncBuiltinESMExports();
