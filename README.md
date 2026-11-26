# Site — Larissa Galvão (Autora)

Site estático (HTML + CSS + um pouco de JS), sem build e sem dependências.

## Estrutura

```
index.html                  # site público (fallback estático + hidratação Firestore, GA4 e Web Push)
admin.html                  # painel administrativo (login Google, RBAC por bloco, R2, newsletter e push)
firebase-messaging-sw.js    # service worker de Web Push (FCM)
firestore.rules             # regras de segurança Firestore com permissões por bloco
assets/                     # config pública, núcleo CMS compartilhado, hidratação do site e app do painel
worker/                     # Cloudflare Worker (upload seguro para R2 + envio/inscrição Web Push FCM)
docs/setup-admin.md         # guia passo a passo de configuração (Firebase Spark, R2, Worker e GA4)
tests/                      # verificações automatizadas (Playwright / Node)
tools/                      # imagem de prévia do link e script de deploy
.github/workflows/pages.yml # testa e publica no GitHub Pages
images/                     # page_bg.jpg (fundo único da página inteira, sem texto), retrato e capas
```

## Rodar localmente

Abra `index.html` no navegador, ou sirva a pasta:

```bash
python3 -m http.server 8080   # http://localhost:8080
```

## Publicar (custo zero)

O site é publicado no GitHub Pages pelo workflow `.github/workflows/pages.yml`, a cada push na `main`.
O workflow roda os testes e só publica se todos passarem. Em pull requests ele apenas roda os testes.

**Configuração única:** Settings → Pages → Build and deployment → Source: **GitHub Actions**.

**Domínio próprio:** registre o domínio, aponte o DNS para o GitHub Pages
([instruções](https://docs.github.com/pages/configuring-a-custom-domain-for-your-github-pages-site))
e informe-o em Settings → Pages → Custom domain. O próximo deploy já usa o domínio novo em tudo.
Para publicar na hora, rode o workflow manualmente (Actions → Publicar site → Run workflow).
O código não precisa mudar.

### Prévia do link (WhatsApp, Facebook…)

Esses aplicativos leem as tags `og:*` do `<head>` sem executar JavaScript, então a imagem precisa de um endereço absoluto.
No repositório, as tags usam o endereço padrão (`FALLBACK_SITE_URL`). No deploy, `tools/set-site-url.js` troca esse
endereço pelo endereço publicado que o GitHub Pages informa (`configure-pages` → `base_url`).

- Imagem de prévia: `images/og-image.jpg` (1200×630), gerada a partir de `tools/og-image.html`.
  Ao trocar capas ou textos, rode `node tools/build-og-image.js`.
- WhatsApp e Facebook guardam a prévia em cache. Depois de mudar a imagem ou o domínio, use o
  [Sharing Debugger](https://developers.facebook.com/tools/debug/) do Facebook para forçar a atualização.

Para publicar em outro host estático (Cloudflare Pages, Netlify…), rode antes `node tools/set-site-url.js https://seu-endereco/ index.html`.

## O que ajustar antes de publicar

- **Endereço do site**: nada a fazer. Veja [Endereço do site e compartilhamento](#endereço-do-site-e-compartilhamento).
- **Links da Amazon**: hoje fazem uma busca pelo título; troque pelos links reais de cada livro.
- **Redes sociais**: os ícones do topo e o botão Instagram apontam para a página inicial de cada rede.
- **Newsletter**: o formulário só mostra a confirmação. Para captar e-mails, ligue o `<form id="lg-news">` a um serviço (Brevo, Mailchimp, Formspree…).
- **Imagens**: são recortes ampliados de uma imagem de 1024 px; substitua pelas artes originais em alta resolução mantendo os mesmos nomes.
- **Fontes**: Cormorant Garamond e EB Garamond, via Google Fonts.

## Fundo contínuo

A página inteira usa um único fundo (`images/page_bg.jpg`, proporção 1024×1536 da arte original).
Cada bloco (`header`, `section`, `footer`) tem `aspect-ratio` igual à fatia correspondente da arte,
então o conteúdo cai exatamente sobre o trecho certo do fundo, sem emendas entre blocos.
Em telas até 820 px a proporção é liberada e o fundo passa a cobrir a altura total da página.
Se trocar a arte, mantenha as proporções de cada faixa (52, 278, 236, 580, 146, 132 e 112 px de altura sobre 1024 de largura).

## Ícones de compartilhamento dos livros

As cores dos círculos vêm de classes CSS (bloco `social-network-circles-unified` no `index.html`),
não de estilos inline — assim cards disponíveis e "Em breve" ficam sempre iguais:
`social-whatsapp`, `social-facebook`, `social-instagram` e `social-bookmark`.
Ao adicionar um livro, copie a linha de compartilhamento de um card existente mantendo essas classes
e o link final "Outras formas de compartilhar".

## Endereço do site e compartilhamento

O site descobre sozinho em que endereço está rodando (`window.location`) e usa esse endereço em
todos os compartilhamentos. Por isso funciona igual no GitHub Pages
(`https://dracosdev.github.io/larissagalvao/`), em um domínio próprio ou em `localhost`, sem editar nada ao trocar de domínio.
Parâmetros (`?utm_...`), âncoras (`#livros`) e `index.html` são removidos do link compartilhado.
`FALLBACK_SITE_URL`, no script do final do `index.html`, só é usado quando o arquivo é aberto direto do disco (`file://`).

| Botão | Livro disponível | Livro "Em breve" | Seção "Gostou de algum livro?" |
| --- | --- | --- | --- |
| WhatsApp / Facebook | página do livro na Amazon | endereço do site | endereço do site |
| Instagram / Substack / Outras redes | menu de compartilhamento do aparelho com o link da Amazon | menu do aparelho com o endereço do site | menu do aparelho com o endereço do site |

Instagram e Substack não têm link público de compartilhamento. Por isso esses botões abrem o menu nativo do celular.
No desktop sem esse menu, o texto e o link são copiados para a área de transferência e aparece um aviso.

> Ao publicar no domínio oficial, configure-o no GitHub Pages (Settings → Pages → Custom domain).
> O código não precisa mudar.

## Responsividade

| Largura | Cards de livros por linha |
| --- | --- |
| ≥ 1280 px | 5 |
| 1000–1279 px | 3 (a última linha fica centralizada) |
| 561–999 px | 2 |
| ≤ 560 px | 1 |

- Os ajustes finais ficam no bloco `<style id="responsive-usability">`, no fim do `index.html`.
- Quando o card é estreito (≤ 310 px, via *container query*), o "Recomendar" vai para cima dos ícones em vez de ser cortado.
- Alvos de toque têm no mínimo 24 px (WCAG 2.2), e itens do menu mobile têm 44 px.
- No celular, o menu do rodapé dispensa o separador "|" para não sobrar um no fim da linha quando ele quebra.

## Painel administrativo, GA4 e Web Push

O painel fica em `admin.html` e utiliza **Firebase Spark (Auth Google + Firestore + FCM)**, **Cloudflare Worker + R2** (upload seguro de imagens/ícones e disparo de Web Push) e **Google Analytics (GA4)**.
Para configurar as credenciais, regras de segurança e publicar o Worker, siga [docs/setup-admin.md](docs/setup-admin.md).

## Testes

```bash
node tests/cms-core.test.js
node tests/worker.test.js
node tests/book-share-icons.test.js
node tests/responsive.test.js
node tests/share-links.test.js
node tests/site-url-deploy.test.js
node tests/site-cms-hydration.test.js
node tests/admin-panel.test.js
```

- `cms-core.test.js` valida sanitização XSS de rich text, SVG e URLs, normalização Amazon, RBAC por bloco e exportação/importação CSV.
- `worker.test.js` testa o Cloudflare Worker com assinatura/verificação RS256 real, CORS, permissões Firestore, upload/exclusão no R2 e inscrição/envio de Web Push (FCM).
- `site-cms-hydration.test.js` valida a hidratação dinâmica de todos os blocos no `index.html`, GA4 (`dataLayer`), newsletter e banner de Web Push.
- `admin-panel.test.js` valida login, tela de acesso negado, RBAC por bloco (leitura vs. leitura/escrita), CRUD dos blocos, rich text, upload R2, newsletter, Web Push e gestão de usuários.
- `responsive.test.js` percorre 15 larguras (320 a 1920 px) e verifica layout, alvos de toque e menu mobile, salvando screenshots em `tests/screenshots/`.
- `share-links.test.js` valida os links de compartilhamento em 5 endereços simulados, área de transferência e fallback `file://`.
- `site-url-deploy.test.js` confere as tags de prévia (`og:*`), a imagem 1200×630 e `tools/set-site-url.js`.
- `book-share-icons.test.js` confere os ícones de compartilhamento em desktop, tablet e celular.

