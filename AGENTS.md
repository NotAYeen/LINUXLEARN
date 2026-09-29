# AGENTS.md

Contexto para cualquier agente que trabaje en este repositorio. Leerlo antes de
escribir codigo.

**Estado del proyecto y plan de reanudacion: `PROGRESO.md`.** Ese fichero dice
que esta hecho, que falta, y los contratos exactos (ctx de los comandos, API de
`shell.js`, esquema de las misiones). Consultalo tambien antes de escribir
codigo; si cambias un contrato, actualizalo ahi.

## Que es

LinuxLearn es un simulador de linea de ordenes Linux que corre 100% en el
navegador. El shell (`ls`, `grep`, `find`, `awk`, tuberias, redirecciones,
funciones, `set -euo pipefail`) esta implementado a mano en JavaScript. No hay
backend, no hay WASM, no hay emulacion de proceso real.

## Reglas que no se negocian

1. **El motor no toca el DOM.** `src/engine/` no importa nada de `src/ui/`, no
   usa `window`, `document`, `localStorage`, `Date.now` ni `Math.random`. Tiene
   que poder ejecutarse en Node para los tests. El reloj del sistema esta
   congelado en `2026-02-01 12:00:00 UTC`.
2. **El estado es determinista.** La semilla (`src/engine/seed.js`) construye
   siempre el mismo arbol. Si una prueba depende del orden de `Object.keys` o
   de una marca de tiempo, esta mal.
3. **Los errores se copian de Bash real, en ingles.** `ls: cannot access
   '/x': No such file or directory` va en ingles aunque la interfaz este en
   español. Los mensajes inventados rompen la immersion.
4. **Sin `innerHTML` con datos de usuario o del shell.** La salida del terminal
   se inserta creando elementos de texto. Es la fuga que más veces se ha
   repetido en el proyecto hermano.
5. **Cada sintaxis nueva del parser necesita un caso en `tests/parser.test.js`
   y una comprobacion con bash real.** El motor se compara contra
   `C:\Program Files\Git\bin\bash.exe` en local y contra `bash` de Ubuntu en CI.

## Convenciones

- Español en comentarios, mensajes de interfaz y contenido de misiones. Los
  identificadores del código van en inglés (`resolvePath`, `parseMode`,
  `walk`), como en `errors.js`, `fs.js`, `seed.js`, `lexer.js` y `parser.js`. El
  inglés de GNU se mantiene tal cual: nombres de opciones y texto de errores.
- 4 espacios de sangria, comillas simples, punto y coma al final.
- Funciones pequenas con nombre de verbo: `resolvePath`, `parseMode`,
  `expandWords`, `runPipeline`.
- Los comandos viven en `src/engine/coreutils/<nombre>.js` y exportan un objeto
  `{ name, synopsis, run(ctx, argv) }`. `ctx` lleva `fs`, `stdin`, `stdout`,
  `stderr`, `env`, `cwd` y `shell`.
- No se anaden dependencias sin justificarlo en el PR. Hoy solo hay Vite,
  Vitest, jsdom, terser y sortablejs.

## Comandos

```bash
npm test            # vitest run
npm run validate    # comprueba que las 32 misiones estan bien formadas
npm run test:bash   # comparacion diferencial contra bash real
npm run build       # dist/
```

En PowerShell los scripts Node en linea fallan por el escapado de comillas. Para
probar a mano, escribir un `.mjs` en `shell-tmp/` (esta en `.gitignore`) y
ejecutarlo con `node`.

## Orden de trabajo

El motor va por fases y cada una debe quedar probada antes de pasar a la
siguiente:

1. `errors.js`, `fs.js`, `seed.js` — el sistema de ficheros virtual.
2. `lexer.js`, `parser.js`, `expansion.js` — sintaxis y Cape.
3. `builtins.js` y `coreutils/` — los comandos.
4. `shell.js` — tuberias, listas, funciones, bucles, `trap`, `set`.
5. `src/levels.js` y los validadores.
6. Interfaz, worker y estilos.
7. Publicacion en GitHub Pages.

## La fixture

La sesión arranca como el usuario `agente`, con `HOME=/home/agente`. En el
árbol hay logs de un servidor, datos de acceso, informes, notas de clase y un
script de despliegue roto (que es el guion de la misión 30). Cualquier prueba
que dependa del contenido del árbol debe apoyarse en esa semilla y no crear
ficheros sueltos a mano.
