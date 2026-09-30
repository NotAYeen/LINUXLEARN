/**
 * Lectura de operandos compartida por los comandos de texto.
 *
 * Casi todos los coreutils funcionan igual: una entrada por fichero (o `-`
 * para stdin), opcion `-` para no ordenar, y el error de GNU cuando el
 * fichero no existe. Este modulo centraliza esa parte para que `sort`, `wc`,
 * `uniq` y demas no se diferencien entre si en los mensajes.
 *
 * Mensajes de GNU coreutils 8.32:
 *   sort: cannot read: No such file or directory
 *   wc: /nope: No such file or directory
 */

import { normalizePath } from '../fs.js';

/** Error de GNU: `prog: <fichero>: <motivo>`. */
export function errorFichero(prog, fichero, motivo) {
    return prog + ': ' + fichero + ': ' + motivo;
}

/** Quita la comilla simple que usa GNU al citar un nombre de fichero. */
export function quote(text) {
    return "'" + String(text).replace(/'/g, "'\\''") + "'";
}

/** Motivo de una excepcion del VFS tal cual lo imprime GNU tras los dos puntos. */
export function motivo(error) {
    const message = String(error.message ?? error);
    const sep = message.indexOf(': ');
    return sep >= 0 ? message.slice(sep + 2) : message;
}

/**
 * Abre los operandos para lectura. Devuelve
 * `{ textos: [{ nombre, lineas }], code }` donde `lineas` no lleva el salto
 * final: un fichero vacio da `[]` y uno sin salto final tambien, que es lo
 * que espera `wc -l`.
 *
 * Sin operandos, o con `-`, se lee de `ctx.stdin`. Con `stdin` de una tuberia
 * y varios operandos, GNU no puede leer mas: avisa una vez y sigue.
 */
export function leerEntradas(ctx, prog, operandos, opciones = {}) {
    const textos = [];
    let code = 0;

    if (!operandos.length) {
        textos.push({ nombre: null, lineas: partir(ctx.stdin ?? '') });
        return { textos, code };
    }

    let hayDash = false;
    for (const operando of operandos) {
        if (operando === '-') {
            hayDash = true;
            textos.push({ nombre: null, lineas: partir(ctx.stdin ?? '') });
            continue;
        }
        const abs = normalizePath(ctx.cwd, operando);
        try {
            textos.push({ nombre: operando, lineas: partir(ctx.fs.readFile(abs)) });
        } catch (e) {
            ctx.stderr.write(errorFichero(prog, quote(operando), motivo(e)) + '\n');
            code = 1;
        }
    }

    if (hayDash && textos.length > 1) {
        ctx.stderr.write(prog + (opciones.mensajeDash ?? ": '-' is not a directory and cannot be used with multiple files") + '\n');
        code = 1;
    }
    return { textos, code };
}

/** Corta el contenido en lineas, sin el salto final (como `read` en bash). */
export function partir(contenido) {
    if (contenido === '') return [];
    const sinFinal = contenido.endsWith('\n') ? contenido.slice(0, -1) : contenido;
    return sinFinal.split('\n');
}

/** Vuelca lineas como texto: una por linea y salto al final, como GNU. */
export function juntar(lineas) {
    return lineas.length ? lineas.join('\n') + '\n' : '';
}

/**
 * Etiqueta cada linea con su fichero, como hace `sort` con `-m`: el separador
 * por defecto es un tabulador y va antes del texto.
 */
export function etiquetar(entradas, separador) {
    const out = [];
    for (const entrada of entradas) {
        for (const linea of entrada.lineas) {
            out.push({ linea, fichero: entrada.nombre });
        }
    }
    return out;
}
