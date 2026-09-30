/**
 * clear — limpia la pantalla del terminal.
 *
 * No toca nada: escribe en stdout la misma secuencia de escape que ncurses
 * escribe en un bash de verdad (`\x1b[H\x1b[2J\x1b[3J`), comprobada con
 * `clear | xxd`. Quien la recibe decide que hacer con ella: el terminal de la
 * interfaz borra la pantalla, igual que hace con Ctrl+L, y una tuberia se
 * limita a escribir los bytes, que es lo que haria un bash de verdad.
 *
 * Acepta `-x` para no borrar tambien el historico del scrollback, como GNU.
 */

export default {
    name: 'clear',
    alias: [],
    synopsis: 'clear [-x]',
    run(ctx, argv) {
        const soloScrollback = argv.includes('-x');
        // Sin scrollback a borrar basta con llevar el cursor al principio.
        ctx.stdout.write(soloScrollback ? '\x1b[H' : '\x1b[H\x1b[2J\x1b[3J');
        return 0;
    }
};