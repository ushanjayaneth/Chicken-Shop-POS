import type {IncomingMessage, ServerResponse} from 'node:http';
import {createCoconutHandler} from '../server/coconut.js';
import {serveWebHandler} from '../server/http-function.js';

const handler = createCoconutHandler();
export default function coconut(request: IncomingMessage & {body?: unknown}, response: ServerResponse) {
  return serveWebHandler(handler, request, response);
}
