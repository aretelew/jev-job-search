# The dashboard page

The page `/report` opens. React with [shadcn](https://ui.shadcn.com) components
(base-nova style, Base UI), Tailwind, and Geist.

It is built into one HTML file, with its script, style and font inline, at
`src/report/web/index.html`. That file is committed, so running the tool
needs nothing from this folder. `src/report/page.ts` writes into it the token
the page sends changes with, the statuses it offers and, for a snapshot, the
data.

To change the page:

```bash
cd web
npm install
npm run build
```

Then run `npx jev report --open` from the repo root and reload the page. The
server reads the built file on every request. Commit the built file with the
change.

Add a shadcn component with `npx shadcn@latest add <name>`. The page is
served from this machine only and fetches nothing from the network, so do not
add anything that loads a script, a font or an image from elsewhere.
