import { dependencies, handler } from '../_shared/chat.ts';
import { sendMessage } from './handler.ts';
Deno.serve(handler(sendMessage, dependencies()));
