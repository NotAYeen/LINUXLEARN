/**
 * Registro de comandos del emulador.
 *
 * Un comando se registra bajo su nombre principal y, si hace falta, bajo sus
 * alias (`test` y `[`, `tee` y `T`). El registro es la unica fuente que
 * consulta el ejecutor, de modo que anadir un comando es anadir un modulo.
 */

import { COMANDOS } from './coreutils/index.js';

const registro = new Map();

for (const comando of COMANDOS) {
    registro.set(comando.name, comando);
    for (const alias of comando.alias ?? []) registro.set(alias, comando);
}

export function buscarComando(nombre) {
    return registro.get(nombre) ?? null;
}

export function comandosRegistrados() {
    return new Set(registro.keys());
}

/** Nombres que la interfaz puede ofrecer como sugerencias. */
export function nombresOrdenados() {
    return [...registro.keys()].sort();
}
