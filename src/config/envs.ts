import { logger } from '@platform/logger';
import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.string().default('5000'),
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  REDIS_PORT: z.string().default('6379'),
  REDIS_HOST: z.string().default('localhost'),
  RABBITMQ_URL: z.string().default('amqp://localhost:5672'),
  RABBITMQ_USER: z.string().optional(),
  RABBITMQ_PASS: z.string().optional(),
  RABBITMQ_HEARTBEAT: z.string().default('60'),
});

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  logger.error('Invalid environment variables:', _env.error.message);

  process.exit(1);
}

export const env = _env.data;
