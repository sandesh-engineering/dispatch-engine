import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { env } from '../config/envs';
import { join } from 'path';

const isTs = __filename.endsWith('.ts');

export const datasource = new DataSource({
  type: 'postgres',
  host: env.DB_HOST,
  port: Number(env.DB_PORT),
  username: env.DB_USERNAME,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  entities: [
    isTs
      ? join(__dirname, '../entities/**/*.entity.ts')
      : join(__dirname, '../entities/**/*.entity.js'),
  ],
  migrations: [
    isTs
      ? join(__dirname, './migrations/*.ts')
      : join(__dirname, './migrations/*.js'),
  ],
  synchronize: false,
  logging: env.NODE_ENV === 'development',
});
