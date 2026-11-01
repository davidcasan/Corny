import { createApp } from './app.js';
import { ensureAdminUser, purgeExpiredSessions } from './auth.js';
import { createCelebrityImages } from './celebrity-images.js';
import { config } from './config.js';
import { openDatabase } from './db.js';
import { imageProcessingAvailable } from './images.js';

export function startServer() {
  const db = openDatabase(config.dbPath);
  const { usingDefaultPassword } = ensureAdminUser(db, config.adminPassword);
  purgeExpiredSessions(db);

  const celebrityImages = createCelebrityImages({ db, dir: config.imagesDir });
  const app = createApp({ db, publicDir: config.publicDir, imagesDir: config.imagesDir, celebrityImages });

  const server = app.listen(config.port, () => {
    console.log(`🌽 Corny rodando em http://localhost:${config.port}`);
    if (usingDefaultPassword) {
      console.log('⚠️  O admin ainda usa a senha padrão "admin". Defina ADMIN_PASSWORD no .env.');
    }
    storePendingImages(celebrityImages);
  });

  const shutdown = () => {
    server.close();
    db.close();
    console.log('Banco de dados fechado.');
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Em segundo plano: guarda no servidor as imagens dos cadastros que ainda usam link externo
async function storePendingImages(celebrityImages) {
  if (!(await imageProcessingAvailable())) {
    console.log('⚠️  sharp não instalado: as imagens continuam usando os links originais. Rode npm install.');
    return;
  }

  let retryLater = 0;
  const { total, failed } = await celebrityImages.processPending({
    onProgress: ({ id, result }) => {
      if (result.stored) return;
      if (result.transient) retryLater++;
      console.log(`   ⚠️  imagem #${id} ${result.transient ? 'fica para a próxima vez' : 'ficou com o link original'}: ${result.error}`);
    }
  });
  if (total > 0) {
    const details = [failed - retryLater && `${failed - retryLater} seguem com o link original`, retryLater && `${retryLater} serão tentadas no próximo início`].filter(Boolean);
    console.log(`🖼️  Imagens guardadas no servidor: ${total - failed} de ${total}${details.length ? ` (${details.join('; ')})` : ''}`);
  }
}
