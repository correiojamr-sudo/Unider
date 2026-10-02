import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"
import { Redis } from "https://deno.land/x/upstash_redis@v1.22.0/mod.ts"

const redis = new Redis({
  url: Deno.env.get('UPSTASH_REDIS_REST_URL')!,
  token: Deno.env.get('UPSTASH_REDIS_REST_TOKEN')!,
})

serve(async (req) => {
  // CORS setup
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } })
  }

  try {
    // Auth Check
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )

    const {
      data: { user },
    } = await supabaseClient.auth.getUser()

    if (!user) throw new Error('Unauthorized')

    const { roomId, message } = await req.json()

    // 1. Append message to Redis list
    const redisKey = `room:${roomId}:messages`
    await redis.rpush(redisKey, JSON.stringify(message))

    // 2. Set/Refresh expiration (5 minutes)
    await redis.expire(redisKey, 300)

    // 3. Broadcast message via Realtime (using service role to bypass RLS for broadcasting)
    const serviceClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const channel = serviceClient.channel(roomId)
    await channel.send({
      type: 'broadcast',
      event: 'message',
      payload: message
    })
    serviceClient.removeChannel(channel)

    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    })
  }
})
