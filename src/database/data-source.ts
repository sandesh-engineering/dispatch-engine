import { DataSource } from 'typeorm';
import dotenv from 'dotenv';
import { join } from 'path';

dotenv.config();

const isTs = __filename.endsWith('.ts');

export const datasource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
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
  logging: process.env.NODE_ENV !== 'development' ? true : false,
});
