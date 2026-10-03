import { dependencies, handler } from '../_shared/chat.ts';
import { reportRoom } from './handler.ts';
Deno.serve(handler(reportRoom, dependencies()));
