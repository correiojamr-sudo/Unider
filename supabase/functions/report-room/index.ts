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
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    )

    const { data: { user } } = await supabaseClient.auth.getUser()
    if (!user) throw new Error('Unauthorized')

    const { roomId, reportedUserId, reason } = await req.json()

    // 1. Fetch Authoritative Transcript from Redis
    const redisKey = `room:${roomId}:messages`
    const rawMessages = await redis.lrange(redisKey, 0, -1)

    // Redis lrange returns string array when elements were stringified
    const transcript = rawMessages.map(msg => typeof msg === 'string' ? JSON.parse(msg) : msg)

    // 2. Persist to Postgres via Service Role (Bypass RLS to insert report with auth data)
    const serviceClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { error: dbError } = await serviceClient.from('reported_chats').insert({
        room_id: roomId,
        reporter_id: user.id,
        reported_id: reportedUserId,
        transcript: transcript,
        status: 'pending'
    })

    if (dbError) throw dbError

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
