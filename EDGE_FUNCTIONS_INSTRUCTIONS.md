# Supabase Edge Functions & Upstash Redis Setup

To enable the anti-spoofing reporting and ephemeral memory buffers, you need to deploy the included Edge Functions to your Supabase project.

## 1. Create an Upstash Redis Database
1. Go to [Upstash](https://upstash.com/) and create a free Redis database.
2. Under your database details, scroll down to the "REST API" section.
3. Copy the `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.

## 2. Configure Supabase Secrets
Open your terminal and use the Supabase CLI to set the secrets for your project:

```bash
supabase secrets set UPSTASH_REDIS_REST_URL="your-url"
supabase secrets set UPSTASH_REDIS_REST_TOKEN="your-token"
```

*(Note: The `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are automatically provided to edge functions by the Supabase platform, so you do not need to set those).*

## 3. Deploy the Functions
Deploy both functions to your live project:

```bash
supabase functions deploy send-message --no-verify-jwt
supabase functions deploy report-room --no-verify-jwt
```

*(The `--no-verify-jwt` flag is used because our code manually verifies the user via the Authorization header to handle specific user contexts securely).*

Once deployed, the frontend will automatically invoke these endpoints instead of routing messages directly peer-to-peer.