# Progreso y trabajo pendiente

Documento de reanudación. Se actualiza en cada sesión. **Léelo antes de tocar
nada**, junto con `AGENTS.md`.

Última actualización: 2026-09-28.

---

## 1. Qué es y dónde está

LinuxLearn: simulador de línea de ordenes Linux 100 % en navegador, motor
propio en JavaScript. Sin backend, sin WASM. Reloj congelado en
`2026-02-01 12:00:00 UTC`.

| Fase (ver AGENTS.md) | Estado |
| --- | --- |
| 1. `errors.js`, `fs.js`, `seed.js` | HECHA (con `tests/fs.test.js`) |
| 2. `lexer.js`, `parser.js`, `expansion.js` | HECHA (con `tests/parser.test.js` y `tests/expansion.test.js`) |
| 3. `arith.js`, `builtins.js` y `coreutils/` | HECHA: 52 comandos registrados + `arith.js` para `$(( ))` |
| 4. `shell.js` | HECHA: tuberias, redirecciones, funciones, bucles, `trap`, `set`, subshells |
| 5. `src/levels.js` + validadores | HECHA: 32 misiones, validate en verde, `tests/levels.test.js` |
| 6. Interfaz, panel de mision, estilos | HECHA: terminal interactiva (se escribe y ejecuta ahi), panel con las 4 modalidades, `src/check.js`, estilos, `tests/ui.test.js` y `tests/sesion.test.js` |
| 7. Publicacion en GitHub Pages | HECHA: repo `NotAYeen/LINUXLEARN`, Pages desplegado |

**Estado de la CI (todo en verde, local y en GitHub Actions):** `validate`
32/32 misiones, `test` 104/104, `test:bash` 80/80 casos contra bash real, `build`
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
- `src/engine/coreutils/` — **52 comandos registrados**:
  `awk basename bash cat chmod chown cp cut date dirname echo env false file find
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
- `src/ui/panel.js` — el panel de misión con las cuatro modalidades
  (Terminal, Depuración, Auditoría, Ensamblaje). En la modalidad Terminal no
  escribe nada: se engancha a la terminal con `tty.alEjecutar` y **comprueba
  cada comando en cuanto se ejecuta**, sin botón. Al acertar se dice al momento
  y aparece el botón de "siguiente misión"; mientras no acierta **no regaña**
  (la terminal ya muestra los errores) y solo a partir del tercer intento da
  la diferencia línea a línea.
- `src/check.js` — la comprobación. Se evalúa **el contrato, no el texto**: por
  eso `cat notas.txt` también vale cuando la solución usa el camino completo.
  Si una misión no declarara `salidaEsperada` ni `comprobaciones`, el contrato
  se deriva de la salida de su solución de referencia (con caché), para que la
  comprobación automática siga siendo fiable. Hoy las 32 misiones declaran
  contrato, así que esa vía es solo una red de seguridad.
- `src/main.js` — une terminal, panel y lista de misiones; es lo único que
  arranca la página.
- `tests/` — `fs`, `parser`, `expansion`, `levels`, `engine`, `ui` y `sesion`
  (104 pruebas; solo los dos últimos usan jsdom, el resto corre en node).
  `sesion.test.js` simula una sesión real de alumno: seis comandos escritos en
  la terminal, con errores, `cd` y acierto, y comprueba que el panel reacciona.
- `index.html`, `css/style.css`, `favicon.svg` — la página. `vite.config.js`
  usa `input: 'index.html'` para que `dist/` salga con el HTML y `bundle.js`.
- `scripts/validate-levels.mjs` — valida la forma de `src/levels.js`.
- `scripts/diff-bash.mjs` + `scripts/casos-bash.mjs` — comparación
  diferencial; hoy `CASOS` tiene 80 guiones, todos en verde contra bash.
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

---

## 2. Contrato de los comandos (NO cambiar sin revisar los 52 ya escritos)

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
usa todavia); se puede rellenar ya que el registro tiene 51 comandos.

---

## 5. Trabajo pendiente, en orden

Todo lo de las fases 1 a 7 esta hecho y en verde. Queda pulir:

1. **Rellenar `comandos`** de las 32 misiones con los comandos que aparecen en
   `soluciones[0]` (ya se pueden leer del registro).
2. **`auditoria.tokens`** de las misiones de Auditoria: son listas cortas de
   ejemplo; conviene ampliar la del guion de la 26.
3. **Mensajes de sintaxis**: alinearlos con bash real (ver nota en §1); ahora
   usan el estilo de la casa (`expected 'fi'`), no el de GNU.
4. **Extraer mas comparaciones diferenciales** a `scripts/casos-bash.mjs` (hoy
   80 casos, todos en verde) y cubrir `tar`, `stat`, `id`, `date`, `ln`, `chmod`.
5. **Worker**: `shell.js` corre en el hilo principal con presupuesto de pasos.
   Si algun dia se quiere aislar, `vite.config.js` ya tiene el bloque `worker`.
6. **Ampliar el arbol** de la semilla si alguna mision lo pide (informes,
   `respaldos/` esta vacio a proposito).

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
