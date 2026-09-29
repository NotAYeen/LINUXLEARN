/**
 * id — imprite uid, gid y grupos del usuario.
 *
 * Verificado contra GNU coreutils 8.32 (sin pista de ayuda en los errores de
 * formato, que salen con `error()` y no con `usage()`):
 *   id: cannot print "only" of more than one choice          exit 1
 *   id: cannot print only names or real IDs in default format exit 1
 *   id: 'nadie': no such user                                exit 1
 *   id: cannot find name for group ID 1000                    exit 1 (+ numero)
 *   id: unknown option -- x   Try 'id --help'...              exit 1
 *
 * El conflicto de opciones se comprueba antes que nada, antes incluso de mirar
 * los operandos.
 */

import { ShellError, EXIT_ERROR } from '../errors.js';

/** Error de uso con la ayuda corta, tal y como la imprime GNU. */
function usageError(message) {
    return new ShellError(message + "\nTry 'id --help' for more information.", EXIT_ERROR);
}

/** Error simple sin pista de ayuda. */
function plainError(message) {
    return new ShellError(message, EXIT_ERROR);
}

/** Comilla simple al estilo de GNU. */
function quote(text) {
    return "'" + String(text).replace(/'/g, "'\\''") + "'";
}

/** Desempaqueta las opciones. */
function parseOptions(argv) {
    const opts = { user: false, group: false, groups: false, name: false, operands: [] };
    for (const op of argv.slice(1)) {
        if (op === '--user') { opts.user = true; continue; }
        if (op === '--group') { opts.group = true; continue; }
        if (op === '--groups') { opts.groups = true; continue; }
        if (op === '--name') { opts.name = true; continue; }
        if (op.startsWith('--')) throw usageError('id: unknown option -- ' + op.slice(2));
        if (op.length > 1 && op[0] === '-') {
            for (const flag of op.slice(1)) {
                if (flag === 'u') opts.user = true;
                else if (flag === 'g') opts.group = true;
                else if (flag === 'G') opts.groups = true;
                else if (flag === 'n') opts.name = true;
                else throw usageError('id: unknown option -- ' + flag);
            }
            continue;
        }
        opts.operands.push(op);
    }
    return opts;
}

/** Busca en el passwd por nombre o, si el operando es numerico, por uid. */
function lookup(ctx, operand) {
    const passwd = ctx.shell.passwd || {};
    const names = Object.keys(passwd);
    if (/^[0-9]+$/.test(operand)) {
        const uid = parseInt(operand, 10);
        for (const name of names) if (passwd[name].uid === uid) return name;
        return null;
    }
    return Object.prototype.hasOwnProperty.call(passwd, operand) ? operand : null;
}

export default {
    name: 'id',
    alias: [],
    synopsis: 'id [-u] [-g] [-G] [-n] [USUARIO]',
    run(ctx, argv) {
        const opts = parseOptions(argv);
        const choices = [opts.user, opts.group, opts.groups].filter(Boolean).length;
        if (choices > 1) throw plainError('id: cannot print "only" of more than one choice');
        if (opts.name && choices === 0) {
            throw plainError('id: cannot print only names or real IDs in default format');
        }

        const passwd = ctx.shell.passwd || {};
        const targets = opts.operands.length ? opts.operands : [null];
        let code = 0;
        let out = '';

        for (const operand of targets) {
            let name;
            let uid;
            let gid;
            if (operand == null) {
                name = ctx.shell.user;
                uid = ctx.shell.uid;
                gid = ctx.shell.gid;
            } else {
                name = lookup(ctx, operand);
                if (name == null) {
                    ctx.stderr.write('id: ' + quote(operand) + ': no such user\n');
                    code = 1;
                    continue;
                }
                uid = passwd[name].uid;
                gid = passwd[name].gid;
            }
            const groups = [gid];
            const groupName = (g) => {
                if (g === 0) return 'root';
                for (const key of Object.keys(passwd)) if (passwd[key].gid === g) return key;
                return null;
            };
            const userOk = name != null;

            if (opts.user) {
                out += (opts.name && userOk) ? name + '\n' : String(uid) + '\n';
                continue;
            }
            if (opts.group) {
                const gname = groupName(gid);
                if (opts.name) {
                    if (gname == null) {
                        ctx.stderr.write('id: cannot find name for group ID ' + gid + '\n');
                        code = 1;
                    }
                    out += (gname == null ? String(gid) : gname) + '\n';
                } else {
                    out += String(gid) + '\n';
                }
                continue;
            }
            if (opts.groups) {
                const list = groups.map((g) => {
                    const gname = groupName(g);
                    if (opts.name && gname == null) {
                        ctx.stderr.write('id: cannot find name for group ID ' + g + '\n');
                        code = 1;
                    }
                    if (gname == null) return String(g);
                    return opts.name ? gname : String(g);
                });
                out += list.join(' ') + '\n';
                continue;
            }

            const userText = userOk ? uid + '(' + name + ')' : String(uid);
            const groupText = userOk ? gid + '(' + groupName(gid) + ')' : String(gid);
            const groupList = groups.map((g) => {
                const gname = userOk ? groupName(g) : null;
                return gname == null ? String(g) : g + '(' + gname + ')';
            });
            out += 'uid=' + userText + ' gid=' + groupText + ' groups=' + groupList.join(' ') + '\n';
        }

        ctx.stdout.write(out);
        return code;
    }
};
