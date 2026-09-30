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
 * Salida esperada de una mision que no declara contrato: se obtiene ejecutando
 * su solucion de referencia. Sin esto, una mision sin `salidaEsperada` ni
 * `comprobaciones` daria por buena cualquier comando que no falle, que es
 * justo lo que estropea la comprobacion automatica de la terminal.
 *
 * El resultado se cachea: el motor es determinista, asi que solo hace falta
 * la primera vez.
 */
const esperadoCache = new Map();

function salidaEsperadaDe(mision) {
    const clave = mision.id;
    if (esperadoCache.has(clave)) return esperadoCache.get(clave);
    const referencia = guionDeResolucion(mision, '');
    if (!referencia) return null;
    const r = crearSesion().ejecutar(referencia);
    const valor = { stdout: r.stdout, code: r.code };
    esperadoCache.set(clave, valor);
    return valor;
}

/** Limpia la cache (solo para los tests, que cambian el contenido del arbol). */
export function limpiarCacheEsperadas() {
    esperadoCache.clear();
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
    let hayContrato = false;

    if (typeof esperado === 'string' && esperado.length) {
        hayContrato = true;
        detalles.push(...compararSalida(esperado, resultado.stdout));
    }
    for (const comprobacion of mision.comprobaciones ?? []) {
        hayContrato = true;
        detalles.push(...comprobar(comprobacion, resultado, sesion));
    }

    // Sin contrato escrito, el contrato es la salida de la solucion de
    // referencia: asi la terminal puede dar por buena una respuesta automaticamente.
    if (!hayContrato) {
        const referencia = salidaEsperadaDe(mision);
        if (referencia) {
            if (referencia.code === 0 && resultado.code !== 0) {
                detalles.push({
                    campo: 'code', esperado: 0, obtenido: resultado.code,
                    texto: 'el comando deberia funcionar y ha fallado'
                });
            } else {
                detalles.push(...compararSalida(referencia.stdout, resultado.stdout));
            }
        } else if (resultado.code !== 0) {
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

/**
 * Progreso del alumno, con el prefijo `lxl_` que fija AGENTS.md.
 *
 * El progreso son tres cosas: que misiones estan superadas, cual era la ultima
 * y el historial de la terminal. Las tres se guardan juntas y se leen con este
 * modulo, que es el unico que escribe en `localStorage` (si no, el progreso se
 * pierde en silencio cuando el navegador va justo).
 */

const PREFIJO = 'lxl_';
const CLAVE = PREFIJO + 'progreso';

/**
 * Cuantos comandos se recuerdan. Sin tope, un alumno que trasnoche acabaria
 * con el almacenamiento lleno y perderia el progreso de verdad.
 */
export const LIMITE_HISTORIAL = 200;

/** Progreso vacio, siempre con las tres claves. */
export function progresoVacio() {
    return { misiones: {}, ultimo: null, historial: [] };
}

/** Normaliza lo que llega de `localStorage`: si esta roto, se descarta. */
function sanear(datos) {
    if (!datos || typeof datos !== 'object') return progresoVacio();
    const misiones = {};
    for (const [id, registro] of Object.entries(datos.misiones ?? {})) {
        if (!/^\d+$/.test(id) || !registro || typeof registro !== 'object') continue;
        misiones[id] = {
            abierta: registro.abierta === true,
            superada: registro.superada === true,
            fecha: typeof registro.fecha === 'string' ? registro.fecha : null
        };
    }
    return {
        misiones,
        ultimo: Number.isInteger(datos.ultimo) ? datos.ultimo : null,
        historial: Array.isArray(datos.historial)
            ? datos.historial.filter((linea) => typeof linea === 'string').slice(-LIMITE_HISTORIAL)
            : []
    };
}

/** Lee el progreso de `localStorage`. Devuelve uno vacio si no hay o esta roto. */
export function leerProgreso(almacen) {
    try {
        const texto = almacen?.getItem(CLAVE);
        if (!texto) return progresoVacio();
        return sanear(JSON.parse(texto));
    } catch (e) {
        return progresoVacio();
    }
}

/** Guarda el progreso. Devuelve `false` si el almacenamiento no responde. */
export function guardarProgreso(almacen, progreso) {
    try {
        almacen?.setItem(CLAVE, JSON.stringify(sanear(progreso)));
        return true;
    } catch (e) {
        return false;
    }
}

/** Marca una mision como superada y recuerda cual era la ultima. */
export function registrarSuperada(almacen, idMision) {
    const progreso = leerProgreso(almacen);
    const anterior = progreso.misiones[idMision] ?? {};
    progreso.misiones[idMision] = {
        ...anterior,
        superada: true,
        fecha: new Date().toISOString().slice(0, 10)
    };
    progreso.ultimo = idMision;
    return guardarProgreso(almacen, progreso);
}

/**
 * Guarda que mision esta abierta y el historial de la terminal. Es lo que
 * llama la interfaz al cambiar de mision: antes lo hacia a mano y por eso el
 * historial no se restauraba.
 */
export function registrarSesion(almacen, idMision, historial = []) {
    const progreso = leerProgreso(almacen);
    if (Number.isInteger(idMision)) {
        progreso.ultimo = idMision;
        const anterior = progreso.misiones[idMision] ?? {};
        progreso.misiones[idMision] = { ...anterior, abierta: true, fecha: anterior.fecha ?? null };
    }
    progreso.historial = historial.filter((linea) => typeof linea === 'string').slice(-LIMITE_HISTORIAL);
    return guardarProgreso(almacen, progreso);
}

/** Quita la marca de superada para poder repetir la mision. */
export function desmarcarMision(almacen, idMision) {
    const progreso = leerProgreso(almacen);
    const anterior = progreso.misiones[idMision];
    if (!anterior) return false;
    progreso.misiones[idMision] = { ...anterior, superada: false };
    return guardarProgreso(almacen, progreso);
}

/** Borra el progreso entero. Devuelve `false` si el almacenamiento no responde. */
export function restablecerProgreso(almacen) {
    try {
        almacen?.removeItem(CLAVE);
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Progreso en texto, para copiarlo y pegarlo en otro dispositivo. Es JSON a
 * proposito: el navegador lo valida al pegar y asi un texto truncado se
 * detecta en vez de corromper el progreso.
 */
export function exportarProgreso(almacen) {
    return JSON.stringify(leerProgreso(almacen));
}

/**
 * Lee un progreso exportado.
 *
 * @returns `{ progreso }` si el texto vale, o `{ error }` con el motivo. No
 *   lanza: el texto viene de una caja de texto y puede ser cualquier cosa.
 */
export function importarProgreso(texto) {
    let datos;
    try {
        datos = JSON.parse(String(texto ?? '').trim());
    } catch (e) {
        return { error: 'eso no es un progreso de LinuxLearn (no se puede leer como texto)' };
    }
    if (!datos || typeof datos !== 'object' || Array.isArray(datos)) {
        return { error: 'eso no parece un progreso de LinuxLearn' };
    }
    const progreso = sanear(datos);
    if (!Object.keys(progreso.misiones).length && !progreso.historial.length) {
        return { error: 'el texto es valido pero no contiene ninguna mision' };
    }
    return { progreso };
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