/**
 * env — ejecuta un programa con un entorno modificado, o lo imprime.
 *
 * Verificado contra GNU coreutils 8.32:
 *   env                       -> imprime el entorno, exit 0
 *   env -i                    -> entorno vacio, exit 0
 *   env MIAX=valor            -> imprime el entorno con MIAX=valor, exit 0
 *   env MIAX=valor printenv X -> ejecuta con MIAX en el entorno
 *   env --bogus               -> env: unknown option -- bogus + pista, exit 125
 *   env noexiste              -> env: 'noexiste': No such file or directory, exit 127
 *
 * Desvios conscientes: el entorno se muta sobre la marcha y se restaura en un
 * `finally`, que es la unica forma de que el comando hijo lo vea sin tocar el
 * contrato de `ctx`; las asignaciones se aplican al objeto `env` y a `vars`.
 */

import { ShellError, EXIT_ERROR } from '../errors.js';

/** Error de uso con la ayuda corta y el codigo 125 de env. */
function usageError(message) {
    return new ShellError(message + "\nTry 'env --help' for more information.", 125);
}

/** Desempaqueta opciones, asignaciones y el comando. */
function parseOptions(argv) {
    const opts = { ignore: false, unset: [], assigns: [], command: null };
    let i = 1;
    for (; i < argv.length; i++) {
        const op = argv[i];
        if (op === '--ignore-environment') { opts.ignore = true; continue; }
        if (op === '--unset') {
            if (i + 1 >= argv.length) throw usageError('env: option requires an argument -- u');
            opts.unset.push(argv[++i]);
            continue;
        }
        if (op.startsWith('--unset=')) { opts.unset.push(op.slice('--unset='.length)); continue; }
        if (op === '--') { i++; break; }
        if (op.startsWith('--')) throw usageError('env: unknown option -- ' + op.slice(2));
        if (op.length > 1 && op[0] === '-') {
            const flags = op.slice(1);
            for (let j = 0; j < flags.length; j++) {
                const flag = flags[j];
                if (flag === 'i') { opts.ignore = true; continue; }
                if (flag === 'u') {
                    const rest = flags.slice(j + 1);
                    if (rest) opts.unset.push(rest);
                    else if (i + 1 < argv.length) opts.unset.push(argv[++i]);
                    else throw usageError('env: option requires an argument -- u');
                    break;
                }
                throw usageError('env: unknown option -- ' + flag);
            }
            continue;
        }
        break;
    }
    // Asignaciones hasta el primer argumento que no lo sea.
    for (; i < argv.length; i++) {
        const op = argv[i];
        const m = /^([A-Za-z_][A-Za-z0-9_]*)(?:=(.*))?$/.exec(op);
        if (!m || op.indexOf('=') < 0) break;
        opts.assigns.push([m[1], m[2] == null ? '' : m[2]]);
    }
    if (i < argv.length) opts.command = argv.slice(i);
    return opts;
}

/** Clona el entorno aplicando `-i`, `-u` y las asignaciones. */
function buildEnv(base, opts) {
    const next = {};
    if (!opts.ignore) for (const key of Object.keys(base)) next[key] = base[key];
    for (const key of opts.unset) delete next[key];
    for (const [key, value] of opts.assigns) next[key] = value;
    return next;
}

/** Sustituye el contenido de un objeto por el de otro, preservando la referencia. */
function replaceInto(target, source) {
    for (const key of Object.keys(target)) delete target[key];
    for (const key of Object.keys(source)) target[key] = source[key];
}

export default {
    name: 'env',
    alias: [],
    synopsis: 'env [-i] [-u VAR] [VAR=VALOR]... [COMANDO]...',
    async run(ctx, argv) {
        const opts = parseOptions(argv);
        const next = buildEnv(ctx.env, opts);

        if (!opts.command) {
            let out = '';
            for (const key of Object.keys(next)) out += key + '=' + next[key] + '\n';
            ctx.stdout.write(out);
            return 0;
        }

        const previous = buildEnv(ctx.env, { ignore: false, unset: [], assigns: [] });
        replaceInto(ctx.env, next);
        if (ctx.shell.vars && ctx.shell.vars !== ctx.env) replaceInto(ctx.shell.vars, next);
        try {
            const code = await ctx.shell.lanzarArgv(opts.command);
            return typeof code === 'number' ? code : 0;
        } catch (e) {
            if (e && e.code != null) throw e;
            ctx.stderr.write("env: '" + opts.command[0] + "': No such file or directory\n");
            return 127;
        } finally {
            replaceInto(ctx.env, previous);
            if (ctx.shell.vars && ctx.shell.vars !== ctx.env) replaceInto(ctx.shell.vars, previous);
        }
    }
};
