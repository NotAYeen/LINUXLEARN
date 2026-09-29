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
| 3. `builtins.js` y `coreutils/` | **PARCIAL**: faltan ~35 comandos |
| 4. `shell.js` | **NO EMPEZADA** (es el bloque critico) |
| 5. `src/levels.js` + validadores | HECHA: 32 misiones, `npm run validate` en verde, forma cubierta por `tests/levels.test.js` (la ejecucion de soluciones espera a `shell.js`) |
| 6. Interfaz, worker y estilos | **PARCIAL**: pagina de aterrizaje (`index.html`, `src/main.js`, `css/style.css`, `favicon.svg`) y build en verde; falta el terminal con historial/TAB/Ctrl-C y el panel de mision |
| 7. Publicacion en GitHub Pages | Workflow listo; **falta crear el repo `NotAYeen/LINUXLEARN`, hacer push y activar Pages (`build_type: workflow`)** |

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
- `src/engine/coreutils/` — **23 comandos hechos** (grupo de ficheros):
  `basename date dirname env false file hostname id ln mkdir printenv
  readlink realpath rmdir sleep stat tar touch true which whoami yes`
  más `regex.js` (ayuda compartida de regex POSIX→RegExp, hecha a medias por
  el agente de grep/sed/awk).
  Todos siguen el contrato de §2 y se prueban con
  `node shell-tmp/harness.mjs <comando> ...`.
- `src/levels.js` — las 32 misiones (`MODOS`, `DIFICULTADES`, `COMANDOS`,
  `misionPorId`).
- `tests/` — `fs.test.js`, `parser.test.js`, `expansion.test.js`,
  `levels.test.js` (48 pruebas, `npm test` en verde).
- `index.html`, `src/main.js`, `css/style.css`, `favicon.svg` — aterrizaje
  con el listado de misiones. `vite.config.js` usa `input: 'index.html'`
  para que `dist/` salga con el HTML y `bundle.js` (sin eso no hay Pages).
- `scripts/validate-levels.mjs` — valida la forma de `src/levels.js`.
- `scripts/diff-bash.mjs` + `scripts/casos-bash.mjs` — comparación
  diferencial; hoy `CASOS = []` pasa en verde sin comparar nada.
- `shell-tmp/harness.mjs` — arnés para probar un coreutils **aislado del
  shell** (gitignored).
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

## 2. Contrato de los comandos (NO cambiar sin revisar los 23 ya escritos)

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
  - `shell`: `{ now, uid, gid, user, umask, vars, passwd, lanzar(argvArray),
    lanzarGuion(texto) }` (los dos últimos aún NO existen; los implementa
    `shell.js` y los usan `xargs`, `find -exec`, `bash`, `sh`).
- Devuelve el código de salida o lanza `ShellError(mensaje, codigo)`. El
  mensaje ya lleva el nombre del programa en inglés, tal cual GNU
  (`cat: /nope: No such file or directory`). Los errores que no abortan el
  comando se escriben en `ctx.stderr` y se continúa.
- Sin DOM, sin `Date.now()`, sin `Math.random()`, sin dependencias nuevas.
  Solo `../errors.js`, `../fs.js` y `../expansion.js` (para `globAPatron`).

### Comandos que faltan (repartir entre agentes)

- **Grupo A (texto)**: `sort uniq cut tr tee head tail wc seq rev xargs`.
- **Grupo C (regex pesada)**: `grep sed awk find` (empezado: `regex.js`).
- **Mío / executor**: `ls cat echo printf pwd rm cp mv chmod chown test '['
  bash sh` y `src/engine/builtins.js` (`cd exit export unset set source
  alias unalias read shift return break continue eval exec trap type command
  let umask local : history`).

---

## 3. Contrato de `shell.js` (fase 4, pendiente)

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

`scripts/validate-levels.mjs` ya exige 32 misiones con `brief` ≥ 40,
`objetivos`, `soluciones` y ids correlativos. **Falta**: que `comandos` se
rellene (el validador avisa si un comando no está registrado) y que
`tests/levels.test.js` ejecute cada `soluciones[0]` con el motor y compare
con `salidaEsperada`/`comprobaciones` (una vez exista `shell.js`).

`src/check.js` (pendiente) centralizará esa evaluación para que la interfaz
y los tests usen lo mismo; la interfaz mostrará la diferencia exacta.

---

## 5. Trabajo pendiente, en orden

1. **Publicar** (lo primero, ya está todo en verde local):
   ```bash
   git add -A && git commit -m "LinuxLearn: motor, 32 misiones, tests y aterrizaje"
   git branch -M main
   gh repo create NotAYeen/LINUXLEARN --public --source . --push
   gh api -X POST repos/NotAYeen/LINUXLEARN/pages -f build_type=workflow
   gh run list --repo NotAYeen/LINUXLEARN      # CI + despliegue
   ```
   La URL queda `https://notayeen.github.io/LINUXLEARN/` (ya está en el
   README y en el `canonical` de `index.html`).
2. **Coreutils grupos A y C** (ver §2). Después registrarlos todos en
   `src/engine/coreutils/index.js` (el barril está vacío: hoy el registro
   no tiene NINGÚN comando y `validate-levels` marcaría cada `comandos`).
3. **`src/engine/arith.js`** — evaluador de `$(( ))` (descenso recursivo).
4. **`src/engine/builtins.js`** + **`src/engine/shell.js`** — ver §3.
5. **`scripts/casos-bash.mjs`**: rellenar `CASOS` con guiones comparables
   (nada que dependa de fechas, dueños o `env` real) y añadir el normalizado
   de prefijo en `diff-bash.mjs`. Objetivo: `npm run test:bash` en verde
   con >= 30 casos. Aprovechar para alinear los mensajes de sintaxis con
   bash (ver §1).
6. **`src/levels.js`**: rellenar `comandos`, y verificar cada
   `salidaEsperada` contra bash real (dump del árbol con
   `shell-tmp/volcar-semilla.mjs`; las soluciones candidatas ya se han
   comprobado una a una con `shell-tmp/verificar-misiones.mjs`).
7. **`src/check.js` + `tests/`**: centraliza la evaluación de misiones y
   `tests/levels.test.js` pasa a ejecutar las 32 soluciones con el motor;
   falta `engine.test.js` y `ui.test.js` (jsdom).
8. **Interfaz**: terminal con historial/TAB/Ctrl-C, panel de misión, las 4
   modalidades, progreso en `localStorage` con prefijo `lxl_`. **Sin
   `innerHTML` con salida del shell** (regla 4 de AGENTS.md).
9. **README**: ajustar la dirección de Pages si cambia.

---

## 6. Cómo verificar

```bash
npm test             # vitest
npm run validate     # forma de las 32 misiones
npm run test:bash    # diferencial contra bash real (Git Bash en Windows)
npm run build        # dist/
node shell-tmp/harness.mjs sort -n fichero    # coreutils aislado
& 'C:\Program Files\Git\bin\bash.exe' -c 'sort -n fichero'   # referencia
```

En PowerShell los scripts Node en línea fallan por el escapado: crear un
`.mjs` en `shell-tmp/` y ejecutarlo con `node`.
