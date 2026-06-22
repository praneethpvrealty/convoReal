import fs from 'fs';
import path from 'path';
import Redis from 'ioredis';
import { processWebhook } from '../lib/whatsapp/webhook-handler';

// Helper to manually load Next.js environment files
function loadEnv() {
  const files = ['.env.local', '.env.development', '.env'];
  for (const file of files) {
    const envPath = path.resolve(process.cwd(), file);
    if (fs.existsSync(envPath)) {
      const lines = fs.readFileSync(envPath, 'utf8').split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const equalsIdx = trimmed.indexOf('=');
        if (equalsIdx === -1) continue;
        const key = trimmed.substring(0, equalsIdx).trim();
        let value = trimmed.substring(equalsIdx + 1).trim();
        if (value.startsWith('"') && value.endsWith('"')) {
          value = value.substring(1, value.length - 1);
        } else if (value.startsWith("'") && value.endsWith("'")) {
          value = value.substring(1, value.length - 1);
        }
        if (process.env[key] === undefined) {
          process.env[key] = value;
        }
      }
      console.log(`[Worker] Loaded environment from ${file}`);
    }
  }
}

// Load env variables
loadEnv();

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  console.error('[Worker] REDIS_URL is not set. Worker cannot start.');
  process.exit(1);
}

// Connect to Redis
const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
});

console.log('[Worker] Connected to Redis. Starting queue consumption...');

async function startWorker() {
  while (true) {
    try {
      // BLPOP blocks until a webhook payload is pushed to 'whatsapp-webhooks'
      const result = await redis.blpop('whatsapp-webhooks', 0);
      if (result) {
        const [, payloadStr] = result;
        
        let body: any;
        try {
          body = JSON.parse(payloadStr);
        } catch (parseErr) {
          console.error('[Worker] Failed to parse payload JSON. Moving to Dead Letter Queue...', parseErr);
          const dlqItem = {
            payload: payloadStr,
            error: 'Malformed JSON payload: ' + (parseErr instanceof Error ? parseErr.message : String(parseErr)),
            failedAt: new Date().toISOString(),
          };
          await redis.rpush('whatsapp-webhooks-dlq', JSON.stringify(dlqItem));
          continue;
        }

        console.log(`[Worker] Popped job from queue. Processing...`);
        const startTime = Date.now();
        
        let success = false;
        const maxAttempts = 3;
        let lastError: any = null;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try {
            await processWebhook(body);
            success = true;
            break;
          } catch (processErr) {
            lastError = processErr;
            console.error(`[Worker] Attempt ${attempt}/${maxAttempts} failed:`, processErr);
            if (attempt < maxAttempts) {
              const delay = attempt * 2000; // 2s, 4s backoff
              console.log(`[Worker] Retrying in ${delay}ms...`);
              await new Promise((resolve) => setTimeout(resolve, delay));
            }
          }
        }

        if (success) {
          console.log(`[Worker] Processed job in ${Date.now() - startTime}ms`);
        } else {
          console.error(`[Worker] Job failed after ${maxAttempts} attempts. Moving to Dead Letter Queue (DLQ)...`);
          const dlqItem = {
            payload: body,
            error: lastError instanceof Error ? lastError.message : String(lastError),
            stack: lastError instanceof Error ? lastError.stack : null,
            failedAt: new Date().toISOString(),
          };
          await redis.rpush('whatsapp-webhooks-dlq', JSON.stringify(dlqItem));
        }
      }
    } catch (err) {
      console.error('[Worker] Loop error:', err);
      // Wait 1 second before retrying to prevent hot loops
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

// Handle termination gracefully
process.on('SIGTERM', () => {
  console.log('[Worker] SIGTERM received. Closing Redis connection...');
  redis.disconnect();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[Worker] SIGINT received. Closing Redis connection...');
  redis.disconnect();
  process.exit(0);
});

startWorker();
