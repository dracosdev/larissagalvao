# Site — Larissa Galvão (Autora)

Site estático (HTML + CSS + um pouco de JS), sem build e sem dependências.

## Estrutura

```
index.html      # página completa (estilos inline + script no final)
tests/          # verificações automatizadas com Playwright
images/         # page_bg.jpg (fundo único da página inteira, sem texto), retrato e capas
```

## Rodar localmente

Abra `index.html` no navegador, ou sirva a pasta:

```bash
python3 -m http.server 8080   # http://localhost:8080
```

## Publicar (custo zero)

Qualquer host estático serve: Cloudflare Pages, GitHub Pages, Netlify ou Firebase Hosting.
Exemplo com Cloudflare Pages: `npx wrangler pages deploy . --project-name larissa-galvao`.

## O que ajustar antes de publicar

- **Endereço do site**: troque `https://larissagalvao.com.br` no `index.html` (links de compartilhamento e script do final).
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

## Testes

```bash
node tests/book-share-icons.test.js
```

Confere, em desktop, tablet e celular, que todos os cards de livros têm os mesmos ícones de
compartilhamento (quantidade, tamanho e cor). Usa Playwright + Chromium (`npm i -D playwright` se não houver).
