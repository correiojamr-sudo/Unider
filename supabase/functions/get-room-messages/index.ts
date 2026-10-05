import { dependencies, handler } from '../_shared/chat.ts';
import { getRoomMessages } from './handler.ts';
Deno.serve(handler(getRoomMessages, dependencies()));
