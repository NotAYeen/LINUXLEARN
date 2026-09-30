/**
 * chown — cambia dueno y grupo.
 *
 * Mensajes verificados con GNU coreutils 8.32:
 *   chown: changing ownership of 'x': Operation not permitted
 *   chown: invalid user: 'nadie'
 *   chown: cannot access 'nope': No such file or directory
 *
 * Solo root cambia duenos. En el emulador la sesion arranca como `agente`
 * (uid 1000), asi que sin `sudo` solo puede cambiar ficheros propios y el
 * error es el de GNU.
 */

import { ShellError, EXIT_MISUSE } from '../errors.js';
import { normalizePath } from '../fs.js';
import { motivo, quote } from './io.js';

export default {
    name: 'chown',
    alias: [],
    synopsis: 'chown [OPTION]... OWNER[:GROUP] FILE...',
    run(ctx, argv) {
        const args = argv.slice(1);
        const especificaciones = args.filter((a) => a.startsWith('-') && a !== '--');
        if (especificaciones.length) {
            ctx.stderr.write("chown: unrecognized option '" + especificaciones[0] + "'\n");
            return 1;
        }
        const dueno = args[0];
        const ficheros = args.slice(1);
        if (dueno === undefined || ficheros.length === 0) {
            ctx.stderr.write('chown: missing operand\n');
            return 1;
        }

        const [nombreUsuario, nombreGrupo] = dueno.split(':');
        const passwd = ctx.shell.passwd ?? {};
        let uid = ctx.owner.uid;
        let gid = null;
        if (nombreUsuario) {
            if (/^\d+$/.test(nombreUsuario)) uid = Number(nombreUsuario);
            else if (passwd[nombreUsuario]) uid = passwd[nombreUsuario].uid;
            else {
                ctx.stderr.write("chown: invalid user: '" + nombreUsuario + "'\n");
                return 1;
            }
        }
        if (nombreGrupo) {
            if (/^\d+$/.test(nombreGrupo)) gid = Number(nombreGrupo);
            else {
                const grupo = Object.values(passwd).find((info) => info.group === nombreGrupo);
                if (!grupo) {
                    ctx.stderr.write("chown: invalid group: '" + nombreGrupo + "'\n");
                    return 1;
                }
                gid = grupo.gid;
            }
        }

        let code = 0;
        for (const fichero of ficheros) {
            const abs = normalizePath(ctx.cwd, fichero);
            let nodo = null;
            try {
                nodo = ctx.fs.node(abs, { follow: false });
            } catch (e) {
                ctx.stderr.write("chown: cannot access " + quote(fichero) + "': " + motivo(e) + '\n');
                code = 1;
                continue;
            }
            if (!nodo) {
                ctx.stderr.write("chown: cannot access " + quote(fichero) + "': No such file or directory\n");
                code = 1;
                continue;
            }
            if (ctx.owner.uid !== 0 && nodo.uid !== ctx.owner.uid) {
                ctx.stderr.write("chown: changing ownership of '" + fichero + "': Operation not permitted\n");
                code = 1;
                continue;
            }
            try {
                ctx.fs.chown(abs, uid, gid ?? nodo.gid);
            } catch (e) {
                ctx.stderr.write("chown: changing ownership of '" + fichero + "': " + motivo(e) + '\n');
                code = 1;
            }
        }
        return code;
    }
};
