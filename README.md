# VeckansMat

En Angular-app för att samla recept, planera veckans middagar och skapa en inköpslista.

## Kom igång

Projektet använder Angular 22, Tailwind CSS 4 och Spartan UI. Kräver Node.js 22.22.3+, 24.15.0+ eller 26+.

```bash
npm install
npm start
```

Appen körs lokalt på `http://localhost:4200/`.

## Kommandon

```bash
npm start       # Starta utvecklingsservern
npm run build   # Bygg appen
npm test        # Kör enhetstester
```

## Spartan UI

Spartan UI:s generator är installerad i projektet. Lägg till komponenter efter behov:

```bash
npx ng g @spartan-ng/cli:ui
```

Exempel: `npx ng g @spartan-ng/cli:ui input`.

Komponenternas tillgängliga beteende kommer från `@spartan-ng/brain`; den genererade Helm-koden ligger i repot och kan anpassas.
