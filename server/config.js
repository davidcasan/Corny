import fs from 'node:fs';
import path from 'node:path';

export const ROOT_DIR = path.resolve(import.meta.dirname, '..');

const envFile = path.join(ROOT_DIR, '.env');
if (fs.existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

export const config = {
  port: Number(process.env.PORT) || 3000,
  dbPath: process.env.DB_PATH || path.join(ROOT_DIR, 'cancer2000.db'),
  publicDir: path.join(ROOT_DIR, 'public'),
  imagesDir: process.env.IMAGES_DIR || path.join(ROOT_DIR, 'data', 'images'),
  // Se definido no .env, a senha do admin é sincronizada com este valor a cada início
  adminPassword: process.env.ADMIN_PASSWORD || null
};
