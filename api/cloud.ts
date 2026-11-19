import type {IncomingMessage, ServerResponse} from 'node:http';
import {createMonitorHandler} from '../server/monitor/handler.js';
import {serveWebHandler} from '../server/http-function.js';

const handler = createMonitorHandler();
export default function cloud(request: IncomingMessage & {body?: unknown}, response: ServerResponse) {
  return serveWebHandler(handler, request, response);
}
