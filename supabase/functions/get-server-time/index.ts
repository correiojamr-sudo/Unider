import { dependencies, handler } from '../_shared/chat.ts';
import { getServerTime } from './handler.ts';
Deno.serve(handler(getServerTime, dependencies()));
