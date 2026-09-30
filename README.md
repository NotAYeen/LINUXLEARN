# LinuxLearn

Simulador interactivo para aprender y practicar la línea de órdenes de Linux
directamente en el navegador. Todo el shell es un motor propio escrito en
JavaScript: no hay backend, ni WebAssembly, ni Pty.js, ni un Linux embebido.

- 32 misiones en español, de `pwd` hasta un pipeline de siete etapas.
- Cuatro modalidades: **Terminal**, **Depuración**, **Auditoría** y **Ensamblaje**.
- Un sistema de ficheros virtual determinista, con permisos, enlaces simbólicos
  y usuarios, para que `chmod`, `find` o `tar` tengan consecuencias reales.
- 53 comandos escritos a mano: `grep`, `sed`, `awk`, `find`, `sort`, `uniq`,
  `cut`, `tr`, `tar`, `ls`, `rm`… más los builtins del shell (`cd`, `export`,
  `set`, `trap`, funciones con `local`).
- Errores con el mismo texto que produce Bash y las herramientas GNU.
- Validación doble: reglas internas por misión y comparación diferencial
  contra `bash` real en integración continua (81 guiones en verde).

## Cómo se trabaja

Todo se hace **en la terminal simulada**: escribes el comando, pulsas Enter y
ves su salida y sus errores en el momento, igual que en una terminal de verdad.
No hay que comprobar nada: el simulador **reconoce el acierto solo**, en cuanto
ejecutas el comando, aunque escribas una forma equivalente (`cat notas.txt` en
lugar del camino completo). While no acierta no te regaña —la terminal ya te
ha enseñado el error real— y a partir del tercer intento te da una pista con la
diferencia línea a línea. Al acertar aparece un botón para pasar a la siguiente
misión. El historial (flechas), el TAB para completar, Ctrl-C, Ctrl-L, `clear` e
`history` funcionan igual que en bash.

En la cabecera tienes lo que gobierna tu progreso:

- **Reiniciar máquina** — deja el árbol de ficheros como estaba y vacía el
  historial. Necesario porque hay misiones que cambian el sistema; así puedes
  volver al punto de partida sin perder lo que has superado.
- **Rehacer esta misión** — le quita la marca de superada para repetirla.
- **Exportar / importar progreso** — copia el progreso como texto y pega uno
  en otro dispositivo, por si borras los datos del navegador.
- **Restablecer progreso** — borra todo, y por eso pide dos pulsaciones y
  explica lo que va a pasar antes de hacerlo.

Si el navegador no deja guardar (modo privado, almacenamiento lleno), te lo
dice en vez de perder el progreso en silencio.

## Requisitos

Node.js 22.22 o superior (los tests de interfaz usan `jsdom@30`).

```bash
npm install
npm run dev      # servidor de desarrollo
npm test         # tests del motor y de la interfaz
npm run validate # comprueba la forma de las 32 misiones
npm run test:bash # compara 81 guiones contra bash real
npm run build    # genera dist/
npm run preview  # sirve dist/ tal cual se publicara
```

## Estructura

```
src/engine/     motor: lexico, parser, expansion, arith, builtins, coreutils, shell
src/levels.js   definicion de las 32 misiones y sus comprobaciones
src/check.js    evaluacion de soluciones y progreso del alumno (unico que escribe en localStorage)
src/ui/         interfaz: terminal, panel de misiones y barra de acciones
src/main.js     monta la pagina
scripts/        validacion de misiones y comparacion contra bash real
tests/          tests unitarios, de interfaz y diferenciales
shell-tmp/      arneses y volcados para comparar con bash (fuera de git)
```

El motor esta separado de la interfaz a proposito: `src/engine/shell.js` es una
maquina de estados sin dependencias del DOM, de modo que se puede ejecutar
integro en Node para las pruebas.

## Como se valida una solucion

Cada mision declara un contrato, no una cadena literal. `src/check.js` lo
ejecuta, y lo usan **tanto los tests como la interfaz**, asi que la respuesta que
ve el alumno es la misma que comprueba la CI. Se admite:

- `salidaEsperada`: texto que debe salir por stdout.
- `comprobaciones`: `{ exit_code }`, `{ stderr_contains }`, `{ output_contains }`
  y `{ fs: { path, exists, absent, content, lines, mode, target } }`.
- Las modalidades especiales añaden `fallo` (Depuración), `auditoria` (Auditoría)
  y `bloques` (Ensamblaje), que tienen su propio verificador en
  `src/ui/panel.js`.

La interfaz enseña la diferencia exacta línea a línea y guarda el progreso en
`localStorage` con el prefijo `lxl_`.

## Publicacion

El repositorio publica en GitHub Pages desde `main` mediante GitHub Actions.
El sitio queda en <https://notayeen.github.io/LINUXLEARN/>.

## Licencia

ISC.
