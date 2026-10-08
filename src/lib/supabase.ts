import { createClient } from '@supabase/supabase-js';
import { getPublicConfig } from './publicConfig';
const config = getPublicConfig();
export const supabase = createClient(config.url, config.key);
