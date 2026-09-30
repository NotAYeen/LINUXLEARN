/**
 * pwd — imprime el directorio de trabajo.
 *
 * Mensaje: pwd: cannot get current directory: No such file or directory
 * (solo si el directorio actual ha desaparecido, algo que en el emulador
 *  se comprueba mirando el VFS).
 */

import { ShellError, EXIT_ERROR } from '../errors.js';

export default {
    name: 'pwd',
    alias: [],
    synopsis: 'pwd [-LP]',
    run(ctx, argv) {
        const logico = argv.includes('-L') || argv.includes('--logical') || argv.length === 1;
        const fisico = argv.includes('-P') || argv.includes('--physical');
        const dir = logico || !fisico ? ctx.cwd : (ctx.shell.pwdFisico ?? ctx.cwd);
        if (!ctx.fs.exists(dir)) {
            throw new ShellError('pwd: cannot get current directory: No such file or directory', EXIT_ERROR);
        }
        ctx.stdout.write(dir + '\n');
        return 0;
    }
};
