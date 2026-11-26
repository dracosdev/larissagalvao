# Configuração do Painel Administrativo, Firebase, Cloudflare R2, GA4 e Web Push

Arquitetura 100% no free tier (Firebase Spark + Cloudflare Workers + Cloudflare R2 + GitHub Pages + GA4).

## 1. Firebase (Auth Google, Firestore e Web Push FCM — Plano Spark gratuito)

1. Crie um projeto em [console.firebase.google.com](https://console.firebase.google.com) (mantenha no plano **Spark**, sem necessidade de cartão).
2. **Authentication**:
   - Ative o provedor **Google** em Authentication → Sign-in method.
   - Em Authentication → Settings → Authorized domains, adicione o domínio onde o site está publicado (ex.: `dracosdev.github.io`, domínio próprio e `localhost`).
3. **Cloud Firestore**:
   - Crie o banco de dados em modo de produção (região `southamerica-east1` ou `us-central1`).
   - Edite `firestore.rules` na raiz do repositório e troque `'seu-email-admin@gmail.com'` pelo seu e-mail Google (em minúsculas).
   - Publique as regras em Firestore → Rules (cole o conteúdo de `firestore.rules` ou rode `firebase deploy --only firestore:rules`).
4. **Aplicativo Web + Credenciais públicas**:
   - Em Configurações do projeto → Seus aplicativos → Adicionar app Web (`</>`).
   - Copie o objeto `firebaseConfig` para `assets/config.js` (`LG_CONFIG.firebase`).
   - Adicione seu e-mail em `LG_CONFIG.bootstrapAdmins` (apenas para conveniência da interface; a validação real ocorre nas `firestore.rules` e no Worker).
5. **Web Push (Cloud Messaging / VAPID)**:
   - Em Configurações do projeto → Cloud Messaging → Certificados Push da Web → **Gerar par de chaves**.
   - Copie a chave pública gerada para `LG_CONFIG.vapidKey` em `assets/config.js`.
6. **Conta de Serviço (somente para envio de Web Push pelo Worker)**:
   - Em Configurações do projeto → Contas de serviço → **Gerar nova chave privada** (baixa um `.json`).
   - **Nunca faça commit desse arquivo JSON no Git.** Ele será salvo como segredo encriptado no Cloudflare Worker no passo 2.

## 2. Cloudflare R2 + Cloudflare Worker (Upload seguro de imagens e envio de Web Push)

1. No painel da [Cloudflare](https://dash.cloudflare.com), ative o **R2** (free tier: 10 GB/mês, 1M escritas, 10M leituras, egress gratuito; a Cloudflare pede cartão para ativar a conta R2).
2. Crie o bucket e ative o acesso público de leitura:
   ```bash
   cd worker
   npm install
   npx wrangler login
   npx wrangler r2 bucket create larissagalvao-media
   ```
   - No painel da Cloudflare → R2 → `larissagalvao-media` → Settings → Public Development URL (ou Custom Domain): ative e copie a URL pública (ex.: `https://pub-xxxxxxxx.r2.dev`).
3. Edite `worker/wrangler.toml`:
   - `FIREBASE_PROJECT_ID`: mesmo `projectId` do passo 1.
   - `R2_PUBLIC_URL`: URL pública do bucket R2.
   - `ALLOWED_ORIGINS`: origens do site (ex.: `https://dracosdev.github.io,https://seu-dominio.com.br,http://localhost:8080`).
   - `BOOTSTRAP_ADMINS`: seu e-mail Google administrador (em minúsculas).
4. Salve o JSON da conta de serviço do Firebase como segredo no Worker e publique:
   ```bash
   npx wrangler secret put FIREBASE_SERVICE_ACCOUNT_JSON < /caminho/para/service-account.json
   npm run deploy
   ```
5. Copie a URL publicada do Worker (ex.: `https://larissagalvao-api.seu-usuario.workers.dev`) para `LG_CONFIG.workerUrl` em `assets/config.js`.

## 3. Google Analytics (GA4)

- Crie uma propriedade GA4 em [analytics.google.com](https://analytics.google.com) e obtenha o ID de medição (`G-XXXXXXXXXX`).
- Informe esse ID em `assets/config.js` (`gaMeasurementId`) **ou** diretamente pelo painel em **Analytics e Push (Config)**.

## 4. Primeiro acesso ao painel

1. Abra `/admin.html` (ex.: `https://dracosdev.github.io/larissagalvao/admin.html`).
2. Clique em **Entrar com Google** com o e-mail configurado em `isBootstrapAdmin()`.
3. Na primeira vez, salve os blocos que desejar migrar para o Firestore (os valores padrão já vêm preenchidos com o conteúdo atual do site).
4. Em **Usuários e permissões**, cadastre outras contas Google definindo, para cada um dos 11 blocos, se o usuário tem `Sem acesso`, `Somente leitura` ou `Leitura e escrita`.
5. Em **Newsletter**, você pode importar os e-mails antigos da planilha do Google Sheets usando **Importar CSV** e baixar a lista atualizada a qualquer momento em **Baixar CSV**.
