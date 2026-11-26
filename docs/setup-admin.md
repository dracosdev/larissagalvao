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

## 2. Deploy automatizado via GitHub Actions (Firestore Rules + Cloudflare Worker)

O workflow `.github/workflows/infra.yml` publica automaticamente `firestore.rules` e o Cloudflare Worker (incluindo o segredo de Web Push) sempre que há push na `main` ou execução manual (**Actions → Publicar Infra → Run workflow**).

1. No painel da [Cloudflare](https://dash.cloudflare.com):
   - Ative **R2** e crie o bucket `larissagalvao-media`.
   - No bucket `larissagalvao-media` → **Settings → Public Development URL**, ative o acesso público e copie a URL (`https://pub-....r2.dev`) para `R2_PUBLIC_URL` em `worker/wrangler.toml`.
   - Em **My Profile → API Tokens → Create Token**, use o template **Edit Cloudflare Workers** e crie o token.
   - Copie o **Account ID** exibido na lateral direita da tela inicial da Cloudflare.
2. No GitHub (**Settings → Secrets and variables → Actions → New repository secret**), cadastre os 3 segredos:
   - `FIREBASE_SERVICE_ACCOUNT_JSON`: conteúdo completo do arquivo `.json` da conta de serviço do Firebase.
   - `CLOUDFLARE_API_TOKEN`: token criado na Cloudflare.
   - `CLOUDFLARE_ACCOUNT_ID`: Account ID da Cloudflare.
3. Rode o workflow **Actions → Publicar Infra (Firebase e Cloudflare Worker) → Run workflow**.
4. Copie a URL publicada do Worker exibida no log (ex.: `https://larissagalvao-api.seu-subdominio.workers.dev`) para `LG_CONFIG.workerUrl` em `assets/config.js`.

## 3. Google Analytics (GA4)

- Crie uma propriedade GA4 em [analytics.google.com](https://analytics.google.com) e obtenha o ID de medição (`G-XXXXXXXXXX`).
- Informe esse ID em `assets/config.js` (`gaMeasurementId`) **ou** diretamente pelo painel em **Analytics e Push (Config)**.

## 4. Primeiro acesso ao painel

1. Abra o painel isolado em `https://admin.larissa.zip` (o workflow público do GitHub Pages não publica `admin.html` junto ao site para manter o isolamento de origem).
2. Clique em **Entrar com Google** com o e-mail configurado em `isBootstrapAdmin()`.
3. Na primeira vez, salve os blocos que desejar migrar para o Firestore (os valores padrão já vêm preenchidos com o conteúdo atual do site).
4. Em **Usuários e permissões** (acesso exclusivo de **super-administradores**), cadastre outras contas Google definindo, para cada bloco editorial, se o usuário tem `Sem acesso`, `Somente leitura` ou `Leitura e escrita`.
5. Em **Newsletter**, você pode importar os e-mails antigos da planilha do Google Sheets usando **Importar CSV** e baixar a lista atualizada a qualquer momento em **Baixar CSV**.

## 5. Segurança automatizada no CI e checklist nos consoles (custo zero)

- **Automatizado pelo CI (`infra.yml`)**:
  - `tools/deploy-firestore-rules.js` publica `firestore.rules` na `main`.
  - `tools/harden-firebase-config.js` sincroniza automaticamente **Firebase Auth → Authorized domains** (apenas `larissa.zip`, `www.larissa.zip`, `admin.larissa.zip`, `*.firebaseapp.com` e `*.web.app`) e aplica restrições de **HTTP Referrers e APIs na Web API Key** (se a conta de serviço tiver a role `API Keys Admin`; caso contrário, emite aviso no log).
  - O workflow aceita o secret opcional `FIREBASE_FCM_SERVICE_ACCOUNT_JSON` (conta dedicada apenas a FCM no Worker), com fallback automático para `FIREBASE_SERVICE_ACCOUNT_JSON`.
  - `admin.larissa.zip` recebe os cabeçalhos HTTP de `_admin/_headers` automaticamente via **Cloudflare Workers Builds** (Git integration).
- **Manual no painel Cloudflare**: ative 1 regra gratuita de **Rate Limiting (WAF)** para `/push/subscribe` e `/upload`, e avalie **Cloudflare Access (Zero Trust Free Tier)** na frente de `admin.larissa.zip`.
- **GitHub**: Branch Protection ativa na `main` exigindo aprovação do check `test` e bloqueando force push.
