/**
 * false — termina siempre con codigo 1 y no mira sus operandos.
 *
 * GNU no devuelve error ni con opciones desconocidas: `false --bogus` vale 1.
 */

export default {
    name: 'false',
    alias: [],
    synopsis: 'false',
    run() {
        return 1;
    }
};
