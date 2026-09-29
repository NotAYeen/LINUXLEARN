/**
 * basename — ultima componente de una ruta.
 *
 * El parser de opciones es manual y copia los mensajes de GNU coreutils 8.32,
 * verificados contra `C:\Program Files\Git\bin\bash.exe`.
 *
 * Desvios conscientes:
 *  - No se implementan `--help` ni `--version`: salen como opcion desconocida.
 */

import { ShellError, EXIT_ERROR } from '../errors.js';

/** Quita todas las barras finales de la cadena. */
function stripTrailingSlashes(text) {
    let end = text.length;
    while (end > 0 && text[end - 1] === '/') end--;
    return text.slice(0, end);
}

/** Ultima componente, con las reglas de GNU para '/', '//' y cadena vacia. */
function baseNameOf(text) {
    if (text === '') return '';
    if (text === '//') return '//';
    const base = stripTrailingSlashes(text);
    if (base === '') return '/';
    const slash = base.lastIndexOf('/');
    return slash < 0 ? base : base.slice(slash + 1);
}

/** Retira el sufijo solo si no se come la cadena entera (regla POSIX). */
function removeSuffix(name, suffix) {
    if (!suffix || name.length <= suffix.length) return name;
    return name.endsWith(suffix) ? name.slice(0, name.length - suffix.length) : name;
}

/** Error de uso con la ayuda corta, tal y como la imprime GNU. */
function usageError(message) {
    return new ShellError(message + "\nTry 'basename --help' for more information.", EXIT_ERROR);
}

/** Desempaqueta las opciones y devuelve el resto de operandos. */
function parseOptions(argv) {
    const opts = { multiple: false, suffix: null, suffixSet: false, zero: false, names: [] };
    for (let i = 0; i < argv.length; i++) {
        const op = argv[i];
        if (op === '--') {
            for (let j = i + 1; j < argv.length; j++) opts.names.push(argv[j]);
            break;
        }
        if (op.startsWith('--')) {
            const eq = op.indexOf('=');
            const key = eq < 0 ? op : op.slice(0, eq);
            if (key === '--multiple') { opts.multiple = true; continue; }
            if (key === '--zero') { opts.zero = true; continue; }
            if (key === '--suffix') {
                if (eq >= 0) { opts.suffix = op.slice(eq + 1); opts.suffixSet = true; continue; }
                const value = argv[++i];
                if (value == null) throw usageError('basename: option requires an argument -- suffix');
                opts.suffix = value;
                opts.suffixSet = true;
                continue;
            }
            throw usageError('basename: unknown option -- ' + op.slice(2));
        }
        if (op.length > 1 && op[0] === '-') {
            for (let c = 1; c < op.length; c++) {
                const flag = op[c];
                if (flag === 'a') { opts.multiple = true; continue; }
                if (flag === 'z') { opts.zero = true; continue; }
                if (flag === 's') {
                    const rest = op.slice(c + 1);
                    if (rest !== '') { opts.suffix = rest; opts.suffixSet = true; break; }
                    const value = argv[++i];
                    if (value == null) throw usageError('basename: option requires an argument -- s');
                    opts.suffix = value;
                    opts.suffixSet = true;
                    break;
                }
                throw usageError('basename: unknown option -- ' + flag);
            }
            continue;
        }
        opts.names.push(op);
    }
    return opts;
}

export default {
    name: 'basename',
    alias: [],
    synopsis: 'basename NAME [SUFFIX] | basename -a NAME...',
    run(ctx, argv) {
        const opts = parseOptions(argv.slice(1));
        if (!opts.names.length) throw usageError('basename: missing operand');

        const max = opts.multiple ? opts.names.length : (opts.suffixSet ? 1 : 2);
        if (opts.names.length > max) {
            throw usageError("basename: extra operand '" + opts.names[max] + "'");
        }

        const positional = !opts.multiple && !opts.suffixSet && opts.names.length === 2;
        const suffix = positional ? opts.names[1] : opts.suffix;
        const source = opts.multiple ? opts.names : [opts.names[0]];
        const results = source.map((name) => removeSuffix(baseNameOf(name), suffix));

        const end = opts.zero ? '\0' : '\n';
        for (const line of results) ctx.stdout.write(line + end);
        return 0;
    }
};
