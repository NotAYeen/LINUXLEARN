# LinuxLearn

Simulador interactivo para aprender y practicar la línea de órdenes de Linux
directamente en el navegador. Todo el shell es un motor propio escrito en
JavaScript: no hay backend, ni WebAssembly, ni Pty.js, ni un Linux embebido.

- 32 misiones en español, de `pwd` hasta un pipeline de siete etapas.
- Cuatro modalidades: **Terminal**, **Depuración**, **Auditoría** y **Ensamblaje**.
- Un sistema de ficheros virtual determinista, con permisos, enlaces simbólicos
  y usuarios, para que `chmod`, `find` o `tar` tengan consecuencias reales.
- Errores con el mismo texto que produce Bash y las herramientas GNU.
- Validación doble: reglas internas por misión y comparación differential
  contra `bash` real en integración continua.

## Requisitos

Node.js 20 o superior.

```bash
npm install
npm run dev      # servidor de desarrollo
npm test         # tests del motor y de la interfaz
npm run build    # genera dist/
npm run preview  # sirve dist/ tal cual se publicara
```

## Estructura

```
src/engine/     motor: lexico, parser, expansion, builtins, coreutils, shell
src/levels.js   definicion de las 32 misiones y sus comprobaciones
src/ui/         interfaz (terminal, panel de misiones, Navegador)
scripts/        validacion de misiones y comparacion contra bash real
tests/          tests unitarios, de interfaz y diferenciales
```

El motor esta separado de la interfaz a proposito: `src/engine/shell.js` es una
maquina de estados sin dependencias del DOM, de modo que se puede ejecutar
integro en Node para las pruebas.

## Como se valida una solucion

Cada mision declara un contrato, no una cadena literal. Se admite:

- `expected_output`: texto que debe aparecer en la salida.
- `assertions`: `exit_code`, `stderr_contains` y estado del sistema de ficheros
  (`exists`, `content`, `mode`, `lines`, `absent`).

El ejecutor de la interfaz enseña la solucion al instante, con la diferencia
exacta, y guarda el progreso en `localStorage` con el prefijo `lxl_`.

## Publicacion

El repositorio publica en GitHub Pages desde `main` mediante GitHub Actions.
El sitio queda en <https://notayeen.github.io/LINUXLEARN/>.

## Licencia

ISC.
