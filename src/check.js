/**
 * Evaluacion de una solucion de mision.
 *
 * Es el modulo que usan TANTO los tests como la interfaz: si aqui se dice que
 * una respuesta es correcta, es la misma respuesta que ve el alumno. No toca
 * el DOM ni `localStorage`: recibe un almacen opcional para el progreso.
 *
 * Cada evaluacion recibe una sesion nueva del motor, ejecuta la solucion del
 * alumno y devuelve
 *
 *   { correcto, codigo, stdout, stderr, detalles: [...] }
 *
 * donde `detalles` lista los requisitos que no se cumplen, en castellano y con
 * el texto que hay que corregir.
 */

import { crearSesion } from './engine/shell.js';

/** Resolucion de la solucion: devuelve el guion que hay que ejecutar. */
export function guionDeResolucion(mision, respuesta) {
    const texto = String(respuesta ?? '').trim();
    return texto || (mision.soluciones?.[0] ?? '');
}

/**
 * Evalua una respuesta.
 *
 * @param {object} mision  entrada de `NIVELES`
 * @param {string} respuesta  lo que el alumno ha escrito
 * @param {object} opciones  `{ sesion }` para reutilizar una sesion ya iniciada
 */
export function evaluar(mision, respuesta, opciones = {}) {
    const guion = guionDeResolucion(mision, respuesta);
    const sesion = opciones.sesion ?? crearSesion();
    const resultado = sesion.ejecutar(guion);

    const detalles = [];
    const esperado = mision.salidaEsperada;
    if (typeof esperado === 'string' && esperado.length) {
        detalles.push(...compararSalida(esperado, resultado.stdout));
    }
    for (const comprobacion of mision.comprobaciones ?? []) {
        detalles.push(...comprobar(comprobacion, resultado, sesion));
    }

    // Sin contrato declarado, basta con que el guion termine sin errores.
    if (detalles.length === 0 && !esperado && !(mision.comprobaciones ?? []).length) {
        if (resultado.code !== 0) {
            detalles.push({ campo: 'code', esperado: 0, obtenido: resultado.code, texto: 'el comando termino con error' });
        }
    }

    return {
        correcto: detalles.length === 0,
        codigo: resultado.code,
        stdout: resultado.stdout,
        stderr: resultado.stderr,
        guion,
        detalles
    };
}

/** Diferencias entre la salida esperada y la real, como objetos con texto. */
function compararSalida(esperado, obtenido) {
    if (esperado === obtenido) return [];
    const lineasEsperadas = esperado.split('\n');
    const lineasObtenidas = obtenido.split('\n');
    const detalles = [];
    for (let i = 0; i < Math.max(lineasEsperadas.length, lineasObtenidas.length); i++) {
        if (lineasEsperadas[i] === lineasObtenidas[i]) continue;
        detalles.push({
            campo: 'stdout',
            linea: i + 1,
            esperado: lineasEsperadas[i] ?? null,
            obtenido: lineasObtenidas[i] ?? null,
            texto: 'linea ' + (i + 1) + ': esperaba ' + JSON.stringify(lineasEsperadas[i] ?? null)
                + ' y obtuve ' + JSON.stringify(lineasObtenidas[i] ?? null)
        });
        if (detalles.length >= 5) break;
    }
    return detalles;
}

/** Aplica una comprobacion del esquema de mision. */
function comprobar(comprobacion, resultado, sesion) {
    const detalles = [];
    if (comprobacion.exit_code !== undefined && resultado.code !== comprobacion.exit_code) {
        detalles.push({
            campo: 'exit_code',
            esperado: comprobacion.exit_code,
            obtenido: resultado.code,
            texto: 'el comando deberia terminar con codigo ' + comprobacion.exit_code + ' y termino con ' + resultado.code
        });
    }
    if (comprobacion.stderr_contains !== undefined
        && !resultado.stderr.includes(comprobacion.stderr_contains)) {
        detalles.push({
            campo: 'stderr',
            esperado: comprobacion.stderr_contains,
            obtenido: resultado.stderr,
            texto: 'faltaba el aviso "' + comprobacion.stderr_contains + '"'
        });
    }
    if (comprobacion.output_contains !== undefined
        && !resultado.stdout.includes(comprobacion.output_contains)) {
        detalles.push({
            campo: 'stdout',
            esperado: comprobacion.output_contains,
            obtenido: resultado.stdout,
            texto: 'faltaba el texto "' + comprobacion.output_contains + '" en la salida'
        });
    }
    if (comprobacion.fs) detalles.push(...comprobarFichero(comprobacion.fs, sesion));
    return detalles;
}

/** `fs: { path, exists, absent, content, lines, mode, target }`. */
function comprobarFichero(fs, sesion) {
    const detalles = [];
    const abs = normaliza(sesion, fs.path);
    const nodo = sesion.estado.fs.node(abs, { follow: false });

    if (fs.exists === true && !nodo) {
        detalles.push({ campo: 'fs', esperado: 'existe', obtenido: 'no existe', texto: 'deberia existir ' + fs.path });
        return detalles;
    }
    if (fs.absent === true && nodo) {
        detalles.push({ campo: 'fs', esperado: 'no existe', obtenido: 'existe', texto: 'no deberia existir ' + fs.path });
        return detalles;
    }
    if (!nodo) return detalles;

    if (typeof fs.content === 'string') {
        const contenido = nodo.type === 'file' ? nodo.content : '';
        if (!contenido.includes(fs.content)) {
            detalles.push({
                campo: 'fs.content', esperado: fs.content, obtenido: contenido,
                texto: 'el contenido de ' + fs.path + ' no contiene lo esperado'
            });
        }
    }
    if (typeof fs.lines === 'number' && nodo.type === 'file') {
        const cuenta = nodo.content === '' ? 0 : nodo.content.replace(/\n$/, '').split('\n').length;
        if (cuenta !== fs.lines) {
            detalles.push({
                campo: 'fs.lines', esperado: fs.lines, obtenido: cuenta,
                texto: 'el fichero deberia tener ' + fs.lines + ' lineas y tiene ' + cuenta
            });
        }
    }
    if (typeof fs.mode === 'string' && nodo.mode !== parseInt(fs.mode, 8)) {
        detalles.push({
            campo: 'fs.mode', esperado: fs.mode, obtenido: nodo.mode.toString(8),
            texto: 'los permisos de ' + fs.path + ' deberian ser ' + fs.mode
        });
    }
    if (typeof fs.target === 'string' && nodo.target !== fs.target) {
        detalles.push({
            campo: 'fs.target', esperado: fs.target, obtenido: nodo.target,
            texto: 'el enlace deberia apuntar a ' + fs.target
        });
    }
    return detalles;
}

function normaliza(sesion, ruta) {
    return String(ruta).startsWith('/')
        ? String(ruta)
        : sesion.estado.cwd + '/' + String(ruta);
}

// ---------------------------------------------------------------------------

/** Progreso del alumno, con el prefijo `lxl_` que fija AGENTS.md. */
const PREFIJO = 'lxl_';

/** Lee el progreso de `localStorage`. Devuelve un objeto vacio si no hay. */
export function leerProgreso(almacen) {
    try {
        const texto = almacen?.getItem(PREFIJO + 'progreso');
        if (!texto) return { misiones: {}, ultimo: null };
        const datos = JSON.parse(texto);
        return { misiones: datos.misiones ?? {}, ultimo: datos.ultimo ?? null };
    } catch (e) {
        return { misiones: {}, ultimo: null };
    }
}

/** Guarda el progreso. Devuelve `false` si el almacenamiento no responde. */
export function guardarProgreso(almacen, progreso) {
    try {
        almacen?.setItem(PREFIJO + 'progreso', JSON.stringify(progreso));
        return true;
    } catch (e) {
        return false;
    }
}

/** Marca una mision como superada y recuerda cual era la ultima. */
export function registrarSuperada(almacen, idMision) {
    const progreso = leerProgreso(almacen);
    progreso.misiones[idMision] = { superada: true, fecha: new Date().toISOString().slice(0, 10) };
    progreso.ultimo = idMision;
    return guardarProgreso(almacen, progreso);
}

/** Primera mision sin superar, o null si el alumno las termino todas. */
export function siguienteMision(progreso, niveles) {
    for (const mision of niveles) {
        if (!progreso.misiones[mision.id]?.superada) return mision;
    }
    return null;
}

/** Traduce una solucion al texto que se enseña como pista de una modalidad. */
export function pistaDe(mision, indice) {
    const pistas = mision.pistas ?? [];
    return pistas[indice] ?? null;
}