import fs from 'fs';
import path from 'path';
import Redis from 'ioredis';

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
      console.log(`[Replay DLQ] Loaded environment from ${file}`);
    }
  }
}

// Load env variables
loadEnv();

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  console.error('[Replay DLQ] REDIS_URL is not set. Cannot run script.');
  process.exit(1);
}

// Connect to Redis
const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: null,
});

async function runReplay() {
  console.log('[Replay DLQ] Connecting to Redis...');
  
  try {
    const dlqLength = await redis.llen('whatsapp-webhooks-dlq');
    if (dlqLength === 0) {
      console.log('[Replay DLQ] Dead Letter Queue is empty. No messages to replay.');
      redis.disconnect();
      return;
    }

    console.log(`[Replay DLQ] Found ${dlqLength} items in Dead Letter Queue.`);
    console.log('[Replay DLQ] Commencing re-queuing to main queue ("whatsapp-webhooks")...');

    let successCount = 0;
    let failCount = 0;

    // Pop all items from DLQ one by one to avoid locking
    for (let i = 0; i < dlqLength; i++) {
      const dlqItemStr = await redis.lpop('whatsapp-webhooks-dlq');
      if (!dlqItemStr) break;

      try {
        const dlqItem = JSON.parse(dlqItemStr);
        // Original payload could be an object or a string
        const payloadStr = typeof dlqItem.payload === 'string' 
          ? dlqItem.payload 
          : JSON.stringify(dlqItem.payload);

        if (!payloadStr) {
          throw new Error('DLQ item missing payload');
        }

        // Push original payload back to the main queue
        await redis.rpush('whatsapp-webhooks', payloadStr);
        successCount++;
      } catch (err) {
        failCount++;
        console.error(`[Replay DLQ] Error parsing/processing DLQ item at index ${i}:`, err);
        // Put the item back into DLQ so it's not lost
        await redis.rpush('whatsapp-webhooks-dlq', dlqItemStr);
      }
    }

    console.log('--- Replay Complete ---');
    console.log(`Successfully re-queued: ${successCount} items.`);
    if (failCount > 0) {
      console.log(`Failed to process: ${failCount} items (retained in DLQ).`);
    }
  } catch (err) {
    console.error('[Replay DLQ] Operational error:', err);
  } finally {
    redis.disconnect();
  }
}

runReplay();
