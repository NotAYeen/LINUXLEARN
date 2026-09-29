/**
 * file — clasifica el contenido de un fichero.
 *
 * Mensajes verificados contra `file` 5.48 del bash real:
 *   nombre: directory
 *   nombre: symbolic link to /destino
 *   nombre: empty
 *   nombre: ASCII text
 *   cannot open `/x' (No such file or directory)
 *   file: unknown option -- x            (+ usage, codigo 1)
 *
 * La clasificacion es una aproximacion deliberadamente simple (el magic real
 * de file es una base de datos enorme): texto imprimible, texto UTF-8 o
 * `data`. Sin `-i`, `--mime`, `-z`, `-L` ni `-k`.
 */

import { ShellError, EXIT_ERROR } from '../errors.js';
import { normalizePath, dirnameOf } from '../fs.js';

const USAGE = [
    'Usage: file [-bcCdEhikLlNnprsSvzZ0] [--apple] [--extension] [--mime-encoding]',
    '            [--mime-type] [-e <testname>] [-F <separator>]  [-f <namefile>]',
    '            [-m <magicfiles>] [-P <parameter=value>] [--exclude-quiet]',
    '            <file> ...',
    '       file -C [-m <magicfiles>]',
    '       file [--help]'
].join('\n');

/** Error de uso con la ayuda completa, como la imprime file. */
function usageError(message) {
    return new ShellError(message + '\n' + USAGE, EXIT_ERROR);
}

/** Desempaqueta las opciones. */
function parseOptions(argv) {
    const opts = { brief: false, dereference: false, operands: [] };
    for (const op of argv.slice(1)) {
        if (op === '--brief') { opts.brief = true; continue; }
        if (op === '--dereference') { opts.dereference = true; continue; }
        if (op.startsWith('--')) throw usageError('file: unknown option -- ' + op.slice(2));
        if (op.length > 1 && op[0] === '-') {
            for (const flag of op.slice(1)) {
                if (flag === 'b') opts.brief = true;
                else if (flag === 'L') opts.dereference = true;
                else throw usageError('file: unknown option -- ' + flag);
            }
            continue;
        }
        opts.operands.push(op);
    }
    return opts;
}

/** Texto imprimible de ASCII: espacio, tilde y los saltos tipicos. */
function isAsciiText(text) {
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        if (c === 9 || c === 10 || c === 12 || c === 13) continue;
        if (c < 32 || c > 126) return false;
    }
    return true;
}

/** Clasifica el contenido con las tres etiquetas que usa la practica. */
function describe(node, content) {
    if (node.isLink) return 'symbolic link to ' + node.target;
    if (node.isDir) return 'directory';
    if (content.length === 0) return 'empty';
    if (isAsciiText(content)) return 'ASCII text';
    for (let i = 0; i < content.length; i++) {
        const c = content.charCodeAt(i);
        if (c < 32 && c !== 9 && c !== 10 && c !== 12 && c !== 13) return 'data';
        if (c > 126 && (c < 160 || c === 0xfffd)) return 'data';
    }
    return 'UTF-8 Unicode text';
}

export default {
    name: 'file',
    alias: [],
    synopsis: 'file [-b] FICHERO...',
    run(ctx, argv) {
        const opts = parseOptions(argv);
        if (!opts.operands.length) throw usageError('');

        const fs = ctx.fs;
        const actor = { uid: ctx.owner.uid, gid: ctx.owner.gid, groups: [] };
        const width = opts.operands.reduce((max, op) => Math.max(max, op.length), 0) + 2;
        let out = '';

        for (const operand of opts.operands) {
            const abs = normalizePath(ctx.cwd, operand);
            let desc;
            try {
                const node = fs.node(abs, { follow: opts.dereference });
                if (!node) {
                    desc = 'cannot open `' + operand + "' (No such file or directory)";
                } else if (!node.isDir && !fs.canRead(node, actor)) {
                    desc = 'cannot open `' + operand + "' (Permission denied)";
                } else if (node.isDir) {
                    desc = 'directory';
                } else {
                    desc = describe(node, node.isLink ? node.target : node.content);
                }
            } catch (e) {
                desc = 'cannot open `' + operand + "' (No such file or directory)";
            }
            out += opts.brief ? desc : (operand + ':').padEnd(width) + desc;
            out += '\n';
        }
        ctx.stdout.write(out);
        return 0;
    }
};
