# 🌽 Corny

**Cortar o mal pela raiz.** 11 celebridades sorteadas, 10 duelos. Em cada duelo o jogador escolhe quem quer **cortar**; o outro **se salva**. Quem for escolhido até o fim é cortado pela raiz e ganha um ponto no ranking dos **mais cortados**.

*(Antes se chamava Câncer 2000. O nome do banco, `cancer2000.db`, foi mantido para não quebrar instalações existentes.)*

![Made with Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-07405E?style=for-the-badge&logo=sqlite&logoColor=white)
![Express.js](https://img.shields.io/badge/Express.js-000000?style=for-the-badge&logo=express&logoColor=white)

---

## ✨ Características

- **10 duelos eliminatórios**, ranking global (empates dividem a posição) e histórico pessoal
- **Contas automáticas**: digite usuário e senha; se não existir, a conta é criada
- **Login persistente** por cookie de sessão (180 dias)
- **Painel admin**: busca de imagens na Wikipedia/Wikimedia Commons, upload manual (URL ou arquivo até 8 MB), exclusão
- **Responsivo** para celular e PC

---

## 🔧 Pré-requisitos

- **Node.js 22.13 ou superior** ([download](https://nodejs.org/)). O banco usa o SQLite embutido no Node (`node:sqlite`), sem módulo nativo para compilar.

---

## ⚡ Como rodar

### Windows (recomendado)

| Arquivo | O que faz |
|---|---|
| `start.bat` | Sincroniza as dependências, abre o túnel público, mostra a URL e inicia o servidor |
| `stop.bat` | Para **apenas** o servidor e o túnel desta pasta (não mexe em outros `node.exe`) |
| `painel.bat` | Abre o **painel** (janela): status, Iniciar/Parar/Reiniciar, link público, copiar link e log. Alternativa aos bats; pode fechar a janela e deixar o servidor rodando |

**Endereço público:** com `NGROK_DOMAIN` e `NGROK_AUTHTOKEN` no `.env`, o `start.bat` abre o túnel do [ngrok](https://ngrok.com) no seu **endereço fixo** (toda conta grátis tem um, em dashboard.ngrok.com → Domains). O ngrok precisa estar instalado (`winget install ngrok.ngrok` ou Microsoft Store); ele não é baixado solto porque o Windows Defender bloqueia o arquivo avulso como "software potencialmente indesejado". No plano grátis, quem abre pelo navegador vê uma tela de aviso do ngrok antes do jogo. Sem essas variáveis, ou se o ngrok falhar, ele usa o [Cloudflare Quick Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/), grátis e sem conta, mas com endereço (`https://xxxx.trycloudflare.com`) que **muda a cada reinício**. A URL aparece na janela e fica salva em `URL_PUBLICA.txt`.

### Manual

```bash
npm install
npm start          # http://localhost:3000
npm run dev        # reinicia sozinho ao salvar arquivos
npm test           # roda os testes
```

### Configuração (`.env`, opcional)

| Variável | Padrão | Uso |
|---|---|---|
| `ADMIN_PASSWORD` | `admin` | Senha do usuário `admin`. **Defina antes de expor o jogo na internet.** É aplicada a cada início. |
| `PORT` | `3000` | Porta HTTP |
| `DB_PATH` | `cancer2000.db` | Caminho do banco |
| `IMAGES_DIR` | `data/images` | Onde as imagens das celebridades são guardadas |
| `BRAVE_API_KEY` | (vazio) | Ativa a busca de imagens da Brave (web inteira) no admin |
| `NGROK_DOMAIN` | (vazio) | Endereço fixo do ngrok usado pelo `start.bat` (ex.: `nome.ngrok-free.dev`) |
| `NGROK_AUTHTOKEN` | (vazio) | Token da conta ngrok (lido pelo próprio ngrok) |

---

## 🎮 Como usar

**Jogador:** acesse a URL, crie a conta, clique em **Iniciar Jogo** e escolha um dos dois em cada duelo.

**Admin:** entre como `admin`. Busque nomes (vários separados por `;`), troque a imagem entre as opções encontradas e clique em **Adicionar**. Ou use a adição manual com URL ou arquivo. Nomes repetidos são recusados (ignorando acentos e maiúsculas). Excluir uma celebridade a tira dos sorteios e do ranking, mas preserva o histórico de quem já jogou.

**Enquadramento:** na lista de cadastradas, **🎯 Enquadrar** abre a foto inteira. Clique no rosto e, se a pessoa estiver pequena na foto, aumente o zoom (até 3×). As prévias mostram na hora como fica no duelo e no ranking. Os selos na lista indicam o que vale trocar: **⚠️ link externo** (o site não deixou baixar a imagem; passe o mouse para ver o motivo) e **📉 imagem pequena** (menos de 400 px, pode ficar borrada).

---

## 📁 Estrutura

```
server.js                 Ponto de entrada (usado pelo start/stop.bat)
server/
  index.js                Sobe o servidor, admin, encerramento
  app.js                  Express: rotas, páginas, cabeçalhos de segurança, erros
  config.js               Lê o .env
  db.js                   Abre o SQLite e aplica migrações (backup automático antes)
  auth.js                 Hash de senha (scrypt), sessões, middlewares, limite de tentativas
  images.js               Baixa, corrige rotação EXIF e grava as imagens em WebP (sharp)
  celebrity-images.js     Liga as imagens à tabela celebrities; processa as pendentes
  routes/                 auth, admin, game, ranking
  search/                 Busca de imagens: index.js (junta as fontes), filter.js, http.js, sources/
  util/                   Normalização de texto e validações
public/
  *.html                  Só marcação; cada página carrega seu módulo
  styles.css              Tema neon: tokens de cor/fonte no :root, depois componentes
  fonts/                  Lilita One e Fredoka (OFL), servidas pelo próprio jogo
  img/icons.svg           Ícones (sprite): tesoura, broto, milho, folha, troféu...
  img/roots.svg           Raízes da borda inferior
  img/placeholder.svg     Usada quando uma imagem quebra
  js/
    api.js                fetch com tratamento de erro padronizado
    session.js            Usuário logado, redirecionamentos, logout
    dom.js                Criação segura de elementos (sem innerHTML), imagem com moldura/enquadramento
    fullscreen.js
    sound.js              Sons curtos gerados na hora (Web Audio) + botão de mudo
    effects.js            Confete do corte final
    game/state.js         Lógica pura do jogo (testada)
    admin/focal-editor.js Editor de enquadramento (ponto + zoom)
    pages/                login, game, admin, ranking
data/images/              Imagens guardadas (geradas; não vão para o git)
test/                     node:test (lógica do jogo, utilitários, busca, imagens, API, migração)
```

### Banco de dados

A versão do schema fica em `PRAGMA user_version`. Para mudar o schema, acrescente uma migração no fim de `MIGRATIONS` em [server/db.js](server/db.js). Nunca edite uma já existente. Antes de migrar, o banco é copiado para `cancer2000.db.bak-vN`.

---

## 📡 API

Todas as rotas respondem `{ success, ... }`. Em caso de erro: `{ success: false, message }` com o status HTTP adequado.

| Método | Rota | Acesso | Descrição |
|---|---|---|---|
| POST | `/api/login` | público | Login ou criação de conta; define o cookie de sessão |
| POST | `/api/logout` | público | Encerra a sessão |
| GET | `/api/me` | logado | Usuário atual |
| GET | `/api/game/start` | logado | Sorteia 11 e abre uma partida (`gameId`); cada celebridade vem com `wins` (cortes) e a resposta traz `maxWins` (recorde) |
| POST | `/api/game/winner` | logado | `{ gameId, winnerId }`: registra quem foi cortado pela raiz; vale uma vez por partida; devolve `rank` e `wins` (cortes) |
| GET | `/api/ranking` | logado | Top 100 com `rank` |
| GET | `/api/ranking/personal` | logado | Histórico do usuário logado |
| GET | `/api/admin/search-image?name=` | admin | Busca imagens |
| POST | `/api/admin/add-celebrity` | admin | `{ name, imageUrl }` |
| GET | `/api/admin/celebrities` | admin | Lista as ativas |
| PUT | `/api/admin/celebrity/:id/focal` | admin | `{ x, y, zoom }`: ponto em % da imagem e zoom de 1 a 3 |
| DELETE | `/api/admin/celebrity/:id` | admin | Exclusão lógica |

---

## 🎨 Visual

Neon de programa de auditório: roxo profundo com brilho magenta, rosa-choque para cortar, ciano para salvar e amarelo para destaque. Cards, botões e etiquetas têm borda preta grossa e sombra sólida deslocada, para dar volume.

Em cada duelo, quem o jogador escolhe fica com o selo **Na mira!** e continua; o outro ganha o selo **Salvo!**, sobe com uma explosão de estrelinhas e o próximo desafiante cai na vaga dele. No fim, uma tesoura corta a foto ao meio, a metade de baixo cai, entra o carimbo **Cortado!** e chove confete. Cada card mostra a ficha da pessoa e um medidor **Já foi cortado** com o número real de cortes, em relação ao recorde atual.

- Fontes: [Lilita One](https://fonts.google.com/specimen/Lilita+One) (títulos e botões) e [Fredoka](https://fonts.google.com/specimen/Fredoka) (texto), ambas sob a licença SIL Open Font License (`public/fonts/OFL.txt`).
- Ícones e ilustrações: SVG próprios em `public/img/`.
- Sons: curtos e gerados no navegador ("plim" de quem se salva, tesoura e fanfarra no corte final); o botão de alto-falante liga e desliga (a escolha fica salva no aparelho).
- Acessibilidade: tudo funciona por teclado (cards são botões), foco visível em ciano e, com "reduzir movimento" ativado no sistema, sem animações nem chuva de folhas.

---

## 🖼️ Imagens

Ao cadastrar, o servidor baixa a imagem (ou decodifica o upload), corrige a rotação EXIF e grava até 3 larguras em WebP (320, 640 e 960 px, sem nunca ampliar) em `data/images/`. O jogo escolhe o tamanho certo para a tela e para a densidade do celular (`srcset`). O nome do arquivo inclui um hash do conteúdo, então o navegador guarda as imagens em cache por 1 ano.

Se o site de origem não deixar baixar, o cadastro acontece mesmo assim e o jogo usa o link original. O admin vê um aviso e o selo **⚠️ link externo**. Erros temporários (limite de uso, servidor fora) são tentados de novo no próximo início. Ao iniciar, o servidor guarda em segundo plano, uma por vez, as imagens dos cadastros que ainda usam link externo.

Os cards têm proporção fixa (3:4 no duelo, círculo no ranking) e o espaço fica reservado enquanto a imagem carrega, para o layout não pular.

### Como o jogo carrega as fotos

- O primeiro duelo só aparece com as duas fotos já decodificadas (`img.decode()`), baixadas com prioridade alta. Enquanto isso, o botão mostra "CARREGANDO...".
- Enquanto o jogador decide, as outras 9 fotos baixam em fila, na ordem dos duelos, 2 por vez. Assim a foto do próximo duelo nunca divide a rede com as últimas.
- O mosaico de fundo entra por último e usa o mesmo arquivo dos cards: cada foto é baixada uma vez por partida.
- Na troca, quem foi escolhido fica no lugar e só o perdedor sai. O próximo entra na vaga dele quando a foto está pronta; se a rede atrasar mais de 250 ms, o card entra com um skeleton e a foto aparece com fade.
- No último duelo, a foto grande da tela de vencedor dos dois finalistas já começa a carregar.
- As animações usam só `transform` e `opacity`, e são desligadas quando o sistema pede movimento reduzido.

---

## 🔍 Busca de imagens

A busca do admin consulta todas as fontes **em paralelo**, junta os resultados, remove duplicatas (o mesmo arquivo em tamanhos diferentes ou em fontes diferentes conta uma vez só) e descarta o que não é foto de pessoa: SVG, logos, bandeiras, assinaturas, imagens com menos de 250 px ou com proporção de banner. O resultado fica em cache por 30 minutos.

| Fonte | Chave? | O que traz |
|---|---|---|
| Wikipedia PT e EN | não | Foto principal dos 3 artigos que mais batem com o nome |
| Wikidata | não | Foto oficial (P18); acha por apelido e nome alternativo |
| Brave Search | **sim** (`BRAVE_API_KEY`) | Imagens da web inteira, como o Google Imagens. Só entra se a chave existir |
| Wikimedia Commons | não | Até 50 fotos do acervo livre |
| Openverse | não | Até 20 fotos livres (Flickr e outros). Uma consulta por vez; se falhar, pausa 2 min |

Os resultados aparecem nessa ordem: primeiro as fotos principais dos artigos, que quase sempre são da pessoa certa, depois o volume. No admin, cada nome mostra uma grade de miniaturas para clicar e escolher. Links que não abrem saem da grade sozinhos. O terminal do servidor mostra quantas imagens cada fonte trouxe e por que cada uma foi descartada:

```
🔍 "Davi Brito" → Wikipedia PT: 2/3 [descartadas: 1 logo/ícone/bandeira] | Commons: 49/50 [descartadas: 1 duplicada] | ...
```

### Adicionando uma fonte

1. Crie `server/search/sources/minhafonte.js` exportando `async function minhaFonte(name)`, que devolve `[{ url, thumb, width, height, fileName? }]`. `width`, `height` e `fileName` são opcionais e servem para o filtro de qualidade.
2. Use `getJson` de [server/search/http.js](server/search/http.js): ele já manda o `User-Agent`, tem timeout e tenta de novo em erro 429/5xx.
3. Registre a fonte em `DEFAULT_SOURCES` em [server/search/index.js](server/search/index.js). A posição na lista define a ordem dos resultados. Se precisar de chave, passe `enabled: () => Boolean(process.env.MINHA_CHAVE)`.
4. Se ela falhar, as outras continuam. O erro aparece no log e nas estatísticas da tela.

Use só APIs oficiais e respeite os limites de uso de cada uma.

---

## 🐛 Troubleshooting

- **"Tunel nao respondeu"**: veja `tunnel.log` na pasta do jogo.
- **Porta 3000 em uso**: rode `stop.bat` ou defina `PORT` no `.env`.
- **Imagem aparece como silhueta cinza**: o link original quebrou ou o site bloqueia uso externo. Troque a imagem pelo admin.
- **Esqueci a senha do admin**: defina `ADMIN_PASSWORD` no `.env` e reinicie.

---

## 👨‍💻 Autor

**David Casan** · GitHub: [@davidcasan](https://github.com/davidcasan)

## 📄 Licença

MIT
