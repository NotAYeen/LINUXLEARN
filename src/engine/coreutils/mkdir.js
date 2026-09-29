/**
 * mkdir — crea directorios.
 *
 * Mensajes verificados contra GNU coreutils 8.32:
 *   mkdir: missing operand
 *   mkdir: cannot create directory '/x/y': No such file or directory
 *   mkdir: cannot create directory '/x': Not a directory
 *   mkdir: invalid mode 'zzz'
 *   mkdir: created directory '/x'
 *
 * Con `-p` el error de un componente intermedio se refiere a ese componente
 * (`mkdir: cannot create directory '/tmp/tt/somefile': Not a directory`) y en
 * cambio un fichero en la ultima posicion sigue siendo `File exists`.
 *
 * Desvios conscientes: sin `-Z`; los directorios intermedios de `-p` salen con
 * `0777 & ~umask` mientras que `-m` solo afecta al ultimo componente.
 */

import { ShellError, EXIT_ERROR } from '../errors.js';
import { normalizePath, dirnameOf, parseMode } from '../fs.js';

/** Error de uso con la ayuda corta, tal y como la imprime GNU. */
function usageError(message) {
    return new ShellError(message + "\nTry 'mkdir --help' for more information.", EXIT_ERROR);
}

/** Comilla simple al estilo de GNU. */
function quote(text) {
    return "'" + String(text).replace(/'/g, "'\\''") + "'";
}

/** Desempaqueta las opciones; `-m` admite valor pegado (`-m750`). */
function parseOptions(argv) {
    const opts = { parents: false, verbose: false, modeArg: null, operands: [] };
    for (let i = 1; i < argv.length; i++) {
        const op = argv[i];
        if (op === '--parents') { opts.parents = true; continue; }
        if (op === '--verbose') { opts.verbose = true; continue; }
        if (op === '--mode') {
            if (i + 1 >= argv.length) throw usageError('mkdir: option requires an argument -- m');
            opts.modeArg = argv[++i];
            continue;
        }
        if (op.startsWith('--mode=')) { opts.modeArg = op.slice('--mode='.length); continue; }
        if (op.startsWith('--')) throw usageError('mkdir: unknown option -- ' + op.slice(2));
        if (op.length > 1 && op[0] === '-') {
            const flags = op.slice(1);
            for (let j = 0; j < flags.length; j++) {
                const flag = flags[j];
                if (flag === 'p') { opts.parents = true; continue; }
                if (flag === 'v') { opts.verbose = true; continue; }
                if (flag === 'm') {
                    const rest = flags.slice(j + 1);
                    if (rest) opts.modeArg = rest;
                    else if (i + 1 < argv.length) opts.modeArg = argv[++i];
                    else throw usageError('mkdir: option requires an argument -- m');
                    break;
                }
                throw usageError('mkdir: unknown option -- ' + flag);
            }
            continue;
        }
        opts.operands.push(op);
    }
    if (opts.modeArg != null) {
        try {
            opts.mode = parseMode(opts.modeArg, 0o777);
        } catch (e) {
            throw new ShellError("mkdir: invalid mode '" + opts.modeArg + "'", EXIT_ERROR);
        }
    }
    return opts;
}

/** Extrae el errno de una excepcion del VFS. */
function reasonFrom(error) {
    const message = String(error.message);
    const sep = message.indexOf(': ');
    return sep >= 0 ? message.slice(sep + 2) : message;
}

export default {
    name: 'mkdir',
    alias: [],
    synopsis: 'mkdir [-p] [-m MODE] [-v] DIRECTORIO...',
    run(ctx, argv) {
        const opts = parseOptions(argv);
        if (!opts.operands.length) throw usageError('mkdir: missing operand');

        const fs = ctx.fs;
        const actor = { uid: ctx.owner.uid, gid: ctx.owner.gid, groups: [] };
        const plainMode = 0o777 & ~(ctx.shell.umask || 0);
        let code = 0;

        for (const operand of opts.operands) {
            const abs = normalizePath(ctx.cwd, operand);
            let failure = null;
            try {
                failure = opts.parents
                    ? makeParents(ctx, fs, opts, operand, abs, actor, plainMode)
                    : makeOne(ctx, fs, opts, operand, abs, actor, plainMode);
            } catch (e) {
                failure = 'mkdir: cannot create directory ' + quote(operand) + ': ' + reasonFrom(e);
            }
            if (failure != null) {
                ctx.stderr.write(failure + '\n');
                code = 1;
            }
        }
        return code;
    }
};

/** Crea un directorio sin `-p`: comprueba el padre y lo crea de una vez. */
function makeOne(ctx, fs, opts, operand, abs, actor, plainMode) {
    const fail = (reason) => 'mkdir: cannot create directory ' + quote(operand) + ': ' + reason;
    const existing = fs.node(abs, { follow: false });
    if (existing) return fail('File exists');
    const parent = fs.node(dirnameOf(abs));
    if (!parent) return fail('No such file or directory');
    if (!parent.isDir) return fail('Not a directory');
    if (!fs.canWrite(parent, actor)) return fail('Permission denied');
    fs.mkdir(abs, opts.modeArg != null ? opts.mode : plainMode, actor);
    if (opts.verbose) ctx.stderr.write('mkdir: created directory ' + quote(operand) + '\n');
    return null;
}

/** Crea el directorio y todos sus padres, informando de cada uno. */
function makeParents(ctx, fs, opts, operand, abs, actor, plainMode) {
    const isAbsolute = operand.startsWith('/');
    let work = operand;
    while (work.length > 1 && work.endsWith('/')) work = work.slice(0, -1);
    const rawSegs = work.split('/').filter((seg) => seg !== '' && seg !== '.');

    let display = '';
    let current = '/';
    if (!isAbsolute) {
        display = '.';
        current = ctx.cwd;
    }
    for (let i = 0; i < rawSegs.length; i++) {
        const seg = rawSegs[i];
        display = display === '/' || display === '' ? (isAbsolute ? '/' + seg : seg)
            : display === '.' ? seg : display + '/' + seg;
        current = normalizePath('/', current + '/' + seg);
        const last = i === rawSegs.length - 1;
        const fail = (reason) => 'mkdir: cannot create directory ' + quote(display) + ': ' + reason;

        let node = null;
        try {
            node = fs.node(current, { follow: !last });
        } catch (e) {
            return fail(reasonFrom(e));
        }
        if (node) {
            if (last) {
                if (node.isDir) return null;
                return fail('File exists');
            }
            if (!node.isDir) return fail('Not a directory');
            continue;
        }
        const mode = last && opts.modeArg != null ? opts.mode : plainMode;
        try {
            fs.mkdir(current, mode, actor);
        } catch (e) {
            return fail(reasonFrom(e));
        }
        if (opts.verbose) ctx.stderr.write('mkdir: created directory ' + quote(display) + '\n');
    }
    return null;
}
