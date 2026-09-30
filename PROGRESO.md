# Progreso y trabajo pendiente

Documento de reanudación. Se actualiza en cada sesión. **Léelo antes de tocar
nada**, junto con `AGENTS.md`.

Última actualización: 2026-09-30.

**Estado en una línea:** las 7 fases están hechas y desplegadas; el trabajo
abierto es pulido de interfaz (§5). CI en verde: 134 tests, 32 misiones,
81 guiones contra bash real, Pages en vivo.

---

## 1. Qué es y dónde está

LinuxLearn: simulador de línea de ordenes Linux 100 % en navegador, motor
propio en JavaScript. Sin backend, sin WASM. Reloj congelado en
`2026-02-01 12:00:00 UTC`.

| Fase (ver AGENTS.md) | Estado |
| --- | --- |
| 1. `errors.js`, `fs.js`, `seed.js` | HECHA (con `tests/fs.test.js`) |
| 2. `lexer.js`, `parser.js`, `expansion.js` | HECHA (con `tests/parser.test.js` y `tests/expansion.test.js`) |
| 3. `arith.js`, `builtins.js` y `coreutils/` | HECHA: 53 comandos registrados + `arith.js` para `$(( ))` |
| 4. `shell.js` | HECHA: tuberias, redirecciones, funciones, bucles, `trap`, `set`, subshells |
| 5. `src/levels.js` + validadores | HECHA: 32 misiones, validate en verde, `tests/levels.test.js` |
| 6. Interfaz, panel de mision, estilos | HECHA: terminal interactiva (se escribe y ejecuta ahi), panel con las 4 modalidades, `src/check.js`, estilos, `tests/ui.test.js` y `tests/sesion.test.js` |
| 7. Publicacion en GitHub Pages | HECHA: repo `NotAYeen/LINUXLEARN`, Pages desplegado |

**Estado de la CI (todo en verde, local y en GitHub Actions):** `validate`
32/32 misiones, `test` 134/134, `test:bash` 81/81 casos contra bash real, `build`
correcto y Pages desplegado en https://notayeen.github.io/LINUXLEARN/.

Notas de infraestructura que costaron un rato:

- `jsdom@30` exige **Node >= 22.22**; con Node 20 el worker de los tests de
  interfaz no arranca ni en Windows ni en Ubuntu. La CI usa Node 24 y
  `package.json` declara `engines`.
- Solo `tests/ui.test.js` pide jsdom, con el comentario
  `@vitest-environment jsdom` en la cabecera; el resto de tests corre en node,
  que es más rápido.
- `vitest` necesita `pool` explícito si jsdom se pone global: aquí no hace
  falta con el entorno por fichero.

### Ficheros que ya existen y se pueden dar por buenos

- `src/engine/errors.js` — códigos de salida, `ShellError`, `ExitSignal`,
  `InterruptSignal`, `BudgetError`.
- `src/engine/fs.js` — VFS completa: permisos rwx por usuario/grupo/otros,
  enlaces simbólicos, `walk`, `parseMode`, `formatSymbolic`, `normalizePath`.
- `src/engine/seed.js` — árbol determinista (`BASE_TREE`, `BASE_LINKS`,
  `buildSeed`, `SHELL_NOW`, `AGENT_HOME`). Ya incluye el
  `/home/agente/proyecto/scripts/despliegue.sh` roto (misión 30) y
  `datos/accesos.txt` con líneas repetidas (lección de `uniq`).
- `src/engine/lexer.js`, `parser.js`, `expansion.js` — sintaxis completa
  (redirecciones, here-docs, `if/for/while/case`, funciones, `${...}`,
  `$(( ))`, comodines, llaves). Sin números de línea en el AST (ver §3).
  Negación `!` al inicio de una tubería (palabra, no operador: `echo !`
  sigue imprimiendo `!`). `case` sin `esac` lanza `ShellSyntax`.
- `src/engine/registry.js` — registro de comandos (lee `COMANDOS` del barril).
- `src/engine/arith.js` — evaluador de `$(( ))` con la precedencia de bash.
- `src/engine/builtins.js` — los builtins (`cd`, `export`, `set`, `read`,
  `trap`, `source`, `alias`, `local`, `let`, `type`, `exit`, `:`...) y la clase
  `ReturnSignal` para `return`.
- `src/engine/shell.js` — el ejecutor: listas con `&&`/`||`, tuberias con cada
  etapa en subshell, redirecciones (incluidos here-docs y `2>&1`), funciones con
  `local`, bucles, `case`, `trap`, `set -euo pipefail`, presupuesto de pasos y
  `crearSesion()` con `ejecutar`, `escribir`, `cd`, `reset`, `sugerencias`,
  `prompt`, `interrumpir`.
- `src/engine/coreutils/` — **53 comandos registrados**:
  `awk basename bash cat chmod chown clear cp cut date dirname echo env false file find
  grep head hostname id ln ls mkdir mv printenv printf pwd readlink realpath rev rm
  rmdir sed seq sleep sort stat tail tar tee test touch tr true uniq wc which
  whoami xargs yes`, más `io.js` (lectura de operandos compartida), `regex.js`
  (regex POSIX→RegExp) e `index.js` (el barril).
  **Ojo**: un comando que no esté en `COMANDOS` del barril existe en disco pero
  el shell responde `command not found`; así se coló `rev` y solo se vio en la
  CI de Ubuntu.
- `src/levels.js` — las 32 misiones (`MODOS`, `DIFICULTADES`, `COMANDOS`,
  `misionPorId`).
- `src/ui/terminal.js` — el terminal: es **el sitio donde el alumno escribe y
  ejecuta** (no hay un cuadro de texto aparte). Historial con flechas, TAB con
  sugerencias, Ctrl-C, Ctrl-L, pie con el código de salida y `$?`, y foco
  automático en cualquier clic. **Sin `innerHTML`**: cada línea es un nodo de
  texto (hay un test que lo comprueba con un `<img onerror>`).
  API: `tty.alEjecutar = fn`, `tty.historial()`, `tty.ejecutar()`,
  `tty.escribir(texto)`, `tty.reiniciar(historial)`, `tty.sesion` (getter),
  `tty.texto()`, `tty.enfocar()`. El historial vive en la sesión del motor
  (`crearSesion({ historial })`), que es la misma lista que imprime el builtin
  `history` y la que usan las flechas: no hay dos historiales.
  `tty.reiniciar()` crea una sesión nueva (árbol de ficheros intacto) y es lo
  que llama el botón "reiniciar máquina". Las secuencias de escape que suelta
  `clear` se traducen a borrar pantalla, en vez de pintarse.
- `src/ui/panel.js` — el panel de misión con las cuatro modalidades
  (Terminal, Depuración, Auditoría, Ensamblaje). En la modalidad Terminal no
  escribe nada: se engancha a la terminal con `tty.alEjecutar` y **comprueba
  cada comando en cuanto se ejecuta**, sin botón. Al acertar se dice al momento
  y aparece el botón de "siguiente misión"; mientras no acierta **no regaña**
  (la terminal ya muestra los errores) y solo a partir del tercer intento da
  la diferencia línea a línea.
- `src/check.js` — la comprobación y el progreso. Se evalúa **el contrato, no el texto**: por
  eso `cat notas.txt` también vale cuando la solución usa el camino completo.
  Si una misión no declarara `salidaEsperada` ni `comprobaciones`, el contrato
  se deriva de la salida de su solución de referencia (con caché), para que la
  comprobación automática siga siendo fiable. Hoy las 32 misiones declaran
  contrato, así que esa vía es solo una red de seguridad.
  También es **el único módulo que escribe en `localStorage`**
  (`leerProgreso`, `guardarProgreso`, `registrarSuperada`, `registrarSesion`,
  `desmarcarMision`, `restablecerProgreso`, `exportarProgreso`,
  `importarProgreso`). Todo lo que entra de ahí pasa por `sanear`, así que un
  progreso corrupto o truncado no rompe la aplicación, y el historial se corta
  a `LIMITE_HISTORIAL` para no llenar el almacenamiento.
- `src/ui/acciones.js` — la barra de la cabecera: **reiniciar máquina** (el
  árbol de ficheros vuelve a su estado inicial, sin tocar el progreso),
  **rehacer misión**, **exportar/importar progreso** y **restablecer progreso**,
  que exige dos pulsaciones y explica el peligro en vez de usar un modal.
  Devuelve `{ aviso, cancelaConfirmacion, sincroniza, compruebaAlmacenamiento,
  guardaSesion, ... }` para poder probarlo con `click()`.
- `src/main.js` — une terminal, panel, barra de acciones y lista de misiones;
  es lo único que arranca la página. `arrancar()` no hace nada si no encuentra
  `#app` (los tests la llaman a mano). Cablea
  `tty.alEjecutar = (guion, resultado) => panelMision.alComando?.(...)`.
- `tests/` — `fs`, `parser`, `expansion`, `levels`, `engine`, `ui` y `sesion`
  (134 pruebas; solo los dos últimos usan jsdom, el resto corre en node).
  `sesion.test.js` simula una sesión real de alumno: seis comandos escritos en
  la terminal, con errores, `cd` y acierto, y comprueba que el panel reacciona;
  además monta `src/main.js` entero (`arrancar()`) para que el cableado real
  esté cubierto — así se cazó que el enganche del panel se leía un nivel más
  arriba y el acierto automático no llegaba a funcionar en la página.
- `index.html`, `css/style.css`, `favicon.svg` — la página. `vite.config.js`
  usa `input: 'index.html'` para que `dist/` salga con el HTML y `bundle.js`.
- `scripts/validate-levels.mjs` — valida la forma de `src/levels.js`.
- `scripts/diff-bash.mjs` + `scripts/casos-bash.mjs` — comparación
  diferencial; hoy `CASOS` tiene 81 guiones, todos en verde contra bash.
- `.github/workflows/ci.yml` — validate + test + diff-bash + build + Pages.

### Correcciones de motor hechas el 2026-09-28 (no deshacer)

Al pasar los tests a vitest salieron cuatro fallos reales del motor:

1. `fs.js parseMode`: `go-w`, `ug+x`… se aplicaban como `a-…` (las clases
   combinadas no se leían) y la forma `rwxr-xr-x` no entraba en la regex.
   Ahora `terciasDe()` reparte por clase y `symbolicToOctal()` acepta
   `-rwsr-xr-x` y las variantes `S`/`T`.
2. `fs.js formatSymbolic`: ahora escribe `s`, `S`, `t`, `T` como GNU
   (`stat -c %A` depende de ello); ida y vuelta probada en el test.
3. `lexer.js`: `echo ~` (tilde al final de palabra) se quedaba literal; en
   bash es el `HOME`. `~*` y `~$X` siguen sin expandirse, como en bash.
   `expansion.js homeDe`: usuario inexistente devuelve `~user`, no `/`.
4. `parser.js`: `case x in` sin `esac` no daba error; ahora lanza
   `ShellSyntax`. Los mensajes de sintaxis **no** son aún los de bash
   reales (`bash: -c: line 2: syntax error: unexpected end of file from
   \`case' command on line 1`): alinearlos cuando `CASOS` de diff-bash
   cubra sintaxis.

### Bugs reales encontrados y arreglados (no deshacer)

Salieron al hacer la interfaz utilizable, no al hacer tests de motor. Varios
llevaban semanas latentes y **ninguno lo cazaba el suite**: por eso ahora hay
pruebas que montan la aplicación entera.

1. **El historial no se restauraba nunca.** `main.js` guardaba
   `progreso.historial` pero `leerProgreso` devolvía solo `{misiones, ultimo}`.
   Al recargar la página las flechas empezaban vacías.
2. **El progreso se escribía en `localStorage` a mano desde `main.js`**, con un
   `try/catch` que se comía el error: con el almacenamiento lleno el alumno
   veía "guardado" y estaba perdiendo progreso. Ahora solo escribe
   `src/check.js` y `acciones.js` avisa cuando `guardarProgreso` devuelve
   `false` (modo privado, cuota llena).
3. **`registrarSuperada` pisaba el registro de la misión** (se comía
   `abierta`).
4. **`history` salía siempre vacío.** El historial solo se llevaba si se pasaba
   `opciones.registrar`, y nadie la pasaba. Ahora `ejecutarGuion` registra por
   defecto y los guiones internos (`fuente`/`source`, `lanzarGuion`/`bash -c`,
   `eval`, `.bashrc`) pasan `registrar: false`, como en bash.
5. **`clear` no existía** (daba `command not found`). Añadido con la secuencia
   real de ncurses, comprobada con `clear | xxd` → `\x1b[H\x1b[2J\x1b[3J`.
6. **El enganche del panel se leía un nivel más arriba** en `main.js`:
   `montarPanel` devolvía `{ mision, zona, enganche }` y se hacía
   `enganche.comandoEjecutado`, así que **el acierto automático no llegaba a
   comprobarse en la página**. Los tests lo montaban a mano y pasaban. Ahora
   devuelve `alComando` plano y `tests/sesion.test.js` arranca `main.js` de
   verdad.
7. **La CI de Ubuntu falló con el caso `clear`**: sin `TERM` el bash real
   aborta con `TERM environment variable not set`. `diff-bash.mjs` fija
   `TERM=xterm` porque el simulador *es* una terminal.
8. **El corte de bucles infinitos tardaba 1 s y congelaba la página**; ahora se
   corta antes con un mensaje claro y las tuberías sin fin tienen tope de
   salida (256 KiB). `yes` sin argumentos imprimía líneas vacías en vez de `y`.

### Decisiones de interfaz que ya estan tomadas

- **La terminal es el sitio unico de trabajo.** No hay `textarea` para la
  solución: se escribe en la terminal, se pulsa Enter y el panel comprueba ese
  comando al momento.
- **El acierto es automatico y silencioso mientras falla**: los dos primeros
  intentos no dicen nada (la terminal ya enseña el error real) y a partir del
  tercero aparece la diferencia línea a línea. Al acertar, botón de "siguiente
  misión".
- **El botón de comprobar sigue ahí**, pero solo como atajo para forzar la
  pista; no hace falta para resolver.
- **Nada de modales**: las acciones destructivas piden dos pulsaciones y
  enseñan el texto del peligro.
- **Restablecer progreso no reinicia la máquina y viceversa**: son botones
  separados porque se pierden cosas distintas.

---

## 2. Contrato de los comandos (NO cambiar sin revisar los 53 ya escritos)

```js
// src/engine/coreutils/<nombre>.js
import { ShellError, EXIT_ERROR, EXIT_MISUSE, EXIT_NOT_FOUND } from '../errors.js';

export default {
    name: 'ls',
    alias: [],                       // p. ej. test -> ['[']
    synopsis: 'ls [OPTION]... [FILE]...',
    run(ctx, argv) { return 0; }
};
```

- `argv[0]` es el nombre; operandos en `argv.slice(1)`.
- `ctx = { fs, stdin, stdout, stderr, env, cwd, owner, shell }`
  - `fs`: VFS (`node`, `readFile`, `writeFile(abs, txt, modo, owner)`,
    `appendFile`, `mkdir`, `mkdirp`, `unlink`, `exists`, `isDir`, `stat`,
    `walk`). Rutas relativas: `normalizePath(ctx.cwd, ruta)`.
  - `stdin`: string. `stdout`/`stderr`: `{ write(s) }` — nunca `console.log`.
  - `env`: variables exportadas. `cwd`: absoluto. `owner`: `{uid,gid}`.
  - `shell`: `{ now, uid, gid, user, umask, vars, passwd, estado, lanzar(argvArray),
    lanzarGuion(texto), cambiarCwd(ruta), definir(n, v), getVar(n), flujoEntrada }`.
    `lanzar` y `lanzarGuion` los implementa `shell.js` y los usan `xargs`,
    `find -exec`, `bash`, `sh` y `source`.
  - `flujoEntrada`: el objeto vivo de entrada (lo consume `read` linea a
    linea, que es lo que hace funcionar `while read l; do ...; done < f`).
  - `comandoExterno(nombre)`, `builtin(nombre)` y `funcion(nombre)`: para que
    `type` sepa qué es cada cosa.
- Devuelve el código de salida o lanza `ShellError(mensaje, codigo)`. El
  mensaje ya lleva el nombre del programa en inglés, tal cual GNU
  (`cat: /nope: No such file or directory`). Los errores que no abortan el
  comando se escriben en `ctx.stderr` y se continúa.
- Sin DOM, sin `Date.now()`, sin `Math.random()`, sin dependencias nuevas.
  Solo `../errors.js`, `../fs.js` y `../expansion.js` (para `globAPatron`).

### Comandos que se a�adieron en la sesion del 2026-09-28

- **Grupo A (texto)**: `sort uniq cut tr tee head tail wc seq rev xargs`.
- **Grupo C (regex pesada)**: `grep sed awk find` (empezado: `regex.js`).
- **Mío / executor**: `ls cat echo printf pwd rm cp mv chmod chown test '['
  bash sh` y `src/engine/builtins.js` (`cd exit export unset set source
  alias unalias read shift return break continue eval exec trap type command
  let umask local : history`).

---

## 3. Contrato de `shell.js` (fase 4, implementado tal cual)

```js
import { crearSesion } from './src/engine/shell.js';
const sesion = crearSesion();               // arranca con buildSeed()
sesion.ejecutar('ls -l | wc -l');           // -> { stdout, stderr, code }
sesion.ejecutar('x=1');                     // el estado persiste entre llamadas
sesion.escribir('/home/agente/a.txt', 'hola');
sesion.cd('/tmp');
sesion.sugerencias('gr');                   // para el TAB de la interfaz
sesion.prompt();                            // 'agente@linuxlearn:~$ '
sesion.reset();                             // vuelve al arranque
```

Al recargar la página el terminal crea la sesión con el historial guardado:

```js
const sesion = crearSesion({ historial: ['ls -l', 'pwd'] });
```

Ese array es el mismo que imprime `history` y el que recorren las flechas: no
hay dos historiales. Sin opciones, la lista arranca vacía, que es lo que hacen
los tests y `evaluar()`.

Decisiones ya tomadas (mantenerlas):

1. **Prefijo de error**: los comandos externos imprimen `prog: msg` SIN
   prefijo; los builtins y los fallos del shell (no encontrado, redirección,
   sintaxis, `cd`) imprimen `bash: line N: msg`. `diff-bash.mjs` quita el
   prefijo `bash:`/`/usr/bin/bash:` de ambas partes antes de comparar
   (hay que añadirlo a `normalizar()`).
2. **`line N`**: hay que añadir `line` a los nodos del AST en `parser.js`
   (`parseSimple`/`parsePipeline` guardan `this.li + 1`).
3. **Tuberías secuenciales con búfer**: cada etapa se ejecuta con la salida de
   la anterior como `stdin` (no hay streaming). Tope de salida por etapa
   (~1 MB) para no colgar; `BudgetError` para bucles infinitos.
4. **Ámbitos**: subshell `()` y `$( )` copian variables/cwd; funciones,
   bucles e `if` comparten ámbito (alcance dinámico de bash) con pila de
   `local`. Cada etapa de tubería va en subshell.
5. **Alias**: se cargan haciendo `source ~/.bashrc` al crear la sesión;
   expansión de primer nivel solo en el primer palabra. `diff-bash` no debe
   usar alias (bash `-c` no los expande).
6. **Sin worker**: los bucles infinitos se controlan con `BudgetError`
   (presupuesto de pasos). La interfaz corre el motor en el hilo principal.
7. **Scripts**: `./fichero.sh`, `bash fichero.sh` y `sh fichero.sh` ejecutan
   el fichero con el parser (si no es ejecutable → 126; si no existe → 127).
8. `ls -l`/`stat`/`date` **no sirven para diff-bash** (fechas y dueños reales
   difieren); para esas salidas se usan las comprobaciones de misión.

---

## 4. Contrato de misiones (fase 5)

`src/levels.js` exporta `NIVELES`, `MODOS`, `DIFICULTADES`, `COMANDOS`.

```js
{
  id: 1,                       // 1..32 sin huecos
  titulo: '…',
  modo: 'Terminal' | 'Depuracion' | 'Auditoria' | 'Ensamblaje',
  dificultad: 'Basico' | 'Intermedio' | 'Avanzado' | 'Experto',
  brief: '…',                  // >= 40 caracteres
  objetivos: ['…'],
  pistas: ['…'],
  comandos: [],                // ← VACIO hasta que el registro tenga los comandos
  soluciones: ['comando exacto'],
  salidaEsperada: '…',         // o bien comprobaciones
  comprobaciones: [            // contrato alternativo (README)
    { exit_code: 0 },
    { stderr_contains: 'Permission denied' },
    { fs: { path, exists, absent, content, lines, mode, target } }
  ],
  // sólo modalidades especiales:
  fallo: { comando, salida },          // Depuracion: comando roto a corregir
  auditoria: { tokens, indice_error },  // Auditoria: token a señalar
  bloques: ['cat /var/log/app.log', …] // Ensamblaje: etapas a ordenar
}
```

`scripts/validate-levels.mjs` exige 32 misiones con `brief` ≥ 40, `objetivos`,
`soluciones` y ids correlativos. `src/check.js` ya centraliza la evaluación:
la usan `tests/ui.test.js` y `src/ui/panel.js`, así que la respuesta que ve el
alumno es la misma que comprueba el test.

`comandos: []` sigue vacio a proposito en las misiones (el campo avisa que no se
usa todavia); se puede rellenar ya que el registro tiene 53 comandos.

---

## 5. Trabajo pendiente, en orden

Todo lo de las fases 1 a 7 esta hecho y en verde. Queda pulido, y conviene
mirar primero la interfaz porque es lo que nota el alumno.

### 5.1 Pulido de interfaz (lo que más se nota)

1. **Panel de referencia de comandos**: los 53 comandos con su `synopsis` ya
   están en el registro, así que es un listado que se genera. También sería un
   `man` en el motor, si se quiere faithful (ojo con el formato de GNU).
2. **Pantalla de fin de juego**: cuando `siguienteMision()` devuelve `null` no
   pasa nada. Falta un cierre con el recuento y la opción de repasar.
3. **Botones de "misión anterior / siguiente"** en el panel: ahora solo se navega
   con la lista lateral.
4. **Buscador en la lista de misiones** (32 ya son muchas).
5. **Edición de línea estilo readline**: Ctrl+A, Ctrl+E, Ctrl+U, Ctrl+W. Es lo
   que más se echa de menos de una terminal real, y es barato: el campo es un
   `contenteditable`. Ctrl+R (búsqueda en el historial) sería el siguiente paso.
6. **Tamaño de fuente ajustable** y un modo sin destellos.
7. **Notas por misión** (un `textarea` que se guarda) y **modo examen** sin
   pistas ni solución de referencia.

### 5.2 Motor y contenido

8. **Rellenar `comandos`** de las 32 misiones con los comandos de `soluciones[0]`.
9. **`auditoria.tokens`** de las misiones de Auditoría: son listas cortas de
   ejemplo; conviene ampliar la del guion de la 26.
10. **Mensajes de sintaxis**: alinearlos con bash real (ver §1); ahora usan el
    estilo de la casa (`expected 'fi'`), no el de GNU.
11. **Más casos diferenciales** en `scripts/casos-bash.mjs` para `tar`, `stat`,
    `id`, `date`, `ln`, `chmod` (los que no valen son los que dependen de
    fechas o dueños reales: `ls -l`, `stat`, `date`).
12. **Worker**: `shell.js` corre en el hilo principal con presupuesto de pasos.
    Si algun dia se quiere aislar, `vite.config.js` ya tiene el bloque `worker`.
13. **Ampliar el árbol** de la semilla si alguna misión lo pide (informes;
    `respaldos/` está vacío a propósito).

### 5.3 Lo que se aplaza a propósito

- **Streaming en tuberías**: hoy cada etapa se ejecuta con la salida de la
  anterior completa en memoria. Solo importa si alguna misión pide
  `tail -f` o algo equivalente.
- **Navegación por teclado completa** (rotabilidad, foco entre paneles): está
  el foco visible y el foco automático al terminal, que es lo que se nota.

---

## 6. Cómo verificar

```bash
npm test             # vitest (motor + interfaz, jsdom)
npm run validate     # forma de las 32 misiones
npm run test:bash    # diferencial contra bash real (Git Bash en Windows)
npm run build        # dist/
npm run dev          # servidor de desarrollo con recarga
node shell-tmp/comparar-misiones.mjs   # las 32 soluciones contra bash
```

En PowerShell los scripts Node en línea fallan por el escapado: crear un
`.mjs` en `shell-tmp/` y ejecutarlo con `node`.
