/**
 * true — termina siempre con codigo 0 y no mira sus operandos.
 *
 * GNU no devuelve error ni con opciones desconocidas: `true --bogus` vale 0.
 */

export default {
    name: 'true',
    alias: [],
    synopsis: 'true',
    run() {
        return 0;
    }
};
