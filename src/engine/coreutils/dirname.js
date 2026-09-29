/**
 * dirname — directorio que contiene una ruta (operacion lexica, GNU coreutils).
 *
 * No usa `normalizePath` de fs.js porque GNU no colapsa las barras dobles:
 * `dirname //a` es `//`, no `/`. Todo se trabaja sobre la cadena del operando.
 *
 * Desvios conscientes: sin `--help` ni `--version`.
 */

import { ShellError, EXIT_ERROR } from '../errors.js';

/** Solo barras: '//' es especial, el resto se reduce a '/'. */
function slashesOnly(text) {
    return text === '//' ? '//' : '/';
}

/** Quita todas las barras finales, sin bajar de un caracter. */
function stripTrailingSlashes(text) {
    let end = text.length;
    while (end > 1 && text[end - 1] === '/') end--;
    return text.slice(0, end);
}

/** Componente de directorio calculada como la hace GNU, sin normalizar. */
function dirNameOf(text) {
    if (text === '') return '.';
    if (/^\/+$/.test(text)) return slashesOnly(text);
    const work = stripTrailingSlashes(text);
    if (work === '') return '/';
    const slash = work.lastIndexOf('/');
    if (slash < 0) return '.';
    let dir = work.slice(0, slash + 1);
    if (/^\/+$/.test(dir)) return slashesOnly(dir);
    return stripTrailingSlashes(dir);
}

/** Error de uso con la ayuda corta, tal y como la imprime GNU. */
function usageError(message) {
    return new ShellError(message + "\nTry 'dirname --help' for more information.", EXIT_ERROR);
}

export default {
    name: 'dirname',
    alias: [],
    synopsis: 'dirname [OPCION]... RUTA...',
    run(ctx, argv) {
        const paths = [];
        let zero = false;
        let stopped = false;
        for (const op of argv.slice(1)) {
            if (!stopped && op === '--') { stopped = true; continue; }
            if (!stopped && op === '--zero') { zero = true; continue; }
            if (!stopped && op.length > 1 && op[0] === '-' && op !== '-') {
                if (op === '-z') { zero = true; continue; }
                const flag = op.startsWith('--') ? op.slice(2) : op[1];
                throw usageError('dirname: unknown option -- ' + flag);
            }
            paths.push(op);
        }
        if (!paths.length) throw usageError('dirname: missing operand');

        const end = zero ? '\0' : '\n';
        for (const path of paths) ctx.stdout.write(dirNameOf(path) + end);
        return 0;
    }
};
