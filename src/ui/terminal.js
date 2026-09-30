/**
 * El terminal de la interfaz.
 *
 * Reglas que no se rompen (AGENTS.md):
 *  - Nada de `innerHTML` con datos del shell: cada linea se crea como elemento
 *    de texto, porque la salida la escribe el alumno.
 *  - El motor se ejecuta en el hilo principal con un presupuesto de pasos: por
 *    eso `ejecutar` va followed por un `requestAnimationFrame` y el boton de
 *    parar llama a `interrumpir()`.
 *  - El historial, el TAB y Ctrl+C son de aqui; el panel de mision es otro
 *    modulo.
 */

import { crearSesion } from '../engine/shell.js';

/** Atajos de teclado que llegan al shell. */
const TECLAS = {
    flechaArriba: 'historialAnterior',
    flechaAbajo: 'historialSiguiente'
};

/**
 * Monta el terminal sobre un contenedor.
 *
 * @param {HTMLElement} raiz  donde se pinta (contendra .salida y .entrada)
 * @param {object} opciones  `{ onSalida, onEstado, historialInicial }`
 */
export function montarTerminal(raiz, opciones = {}) {
    // El historial vive en la sesion del motor (es el mismo que imprime el
    // builtin `history`), asi que solo se le pasa el que habia antes.
    const historialInicial = opciones.historialInicial ?? [];
    let sesion = crearSesion({ historial: historialInicial });

    const pantalla = crear('div', { class: 'pantalla', role: 'log', 'aria-live': 'polite' });
    const lineaEntrada = crear('div', { class: 'linea-entrada' });
    const prompt = crear('span', { class: 'prompt' });
    const campo = crear('span', { class: 'campo', contenteditable: 'plaintext-only', spellcheck: 'false' });
    const cursor = crear('span', { class: 'cursor' });
    // Pie con el codigo de salida del ultimo comando: util para aprender y
    // no ensucia la salida, como en una terminal de verdad.
    const pie = crear('div', { class: 'terminal-pie' });

    lineaEntrada.append(prompt, campo, cursor);
    raiz.append(pantalla, lineaEntrada, pie);

    function actualizarEstado(resultado) {
        pie.textContent = '';
        pie.append(
            crear('span', {
                text: 'codigo de salida: ' + resultado.code,
                class: resultado.code === 0 ? 'ok' : 'error'
            }),
            crear('span', { class: 'pista-pie', text: '  ·  $? vuelve a dar ' + resultado.code }),
            crear('span', { class: 'conteo', text: '  ·  ' + sesion.historial.length + ' comandos' })
        );
    }

    let posicion = sesion.historial.length;
    let editable = '';
    let ultimo = null;
    /** Enganche del panel de mision: recibe cada comando ejecutado. */
    let enganche = opciones.alEjecutar ?? null;

    // ---- salida -----------------------------------------------------------

    /** Añade una linea a la pantalla. Nunca usa innerHTML. */
    function escribirLinea(texto, clase = '') {
        const linea = crear('div', { class: 'linea ' + clase });
        linea.textContent = texto === '' ? ' ' : texto;
        pantalla.append(linea);
        pantalla.scrollTop = pantalla.scrollHeight;
        return linea;
    }

    function escribirBloque(texto, clase) {
        const lineas = String(texto).replace(/\n$/, '').split('\n');
        for (const linea of lineas) escribirLinea(linea, clase);
    }

    /**
     * `clear` y Ctrl-L escriben una secuencia de escape, como en un bash de
     * verdad. Aqui se traducen a "borra la pantalla" en vez de pintar el
     * numero raro en pantalla.
     */
    function esSecuenciaDeEscape(texto) {
        return /^(?:\x1b\[[0-9;]*[A-Za-z])+\s*$/.test(texto);
    }

    // ---- ejecucion --------------------------------------------------------

    /** Pinta el prompt con el directorio actual. */
    function pintarPrompt() {
        prompt.textContent = sesion.prompt();
    }

    /** Ejecuta lo que hay en el campo de entrada. */
    function ejecutar() {
        const guion = campo.textContent.trim();
        editable = '';
        if (!guion) { pintarPrompt(); return null; }
        // El historial lo lleva la sesion: el motor lo registra al ejecutar
        // (linea 292 de shell.js), asi que `history` y las flechas coinciden.
        posicion = sesion.historial.length + 1;
        ultimo = guion;
        escribirLinea(sesion.prompt() + guion, 'entrada');
        campo.textContent = '';
        let resultado;
        try {
            resultado = sesion.ejecutar(guion);
            if (resultado.stdout && !esSecuenciaDeEscape(resultado.stdout)) escribirBloque(resultado.stdout, 'salida');
            else if (resultado.stdout) pantalla.textContent = '';
            if (resultado.stderr) escribirBloque(resultado.stderr, 'error');
        } catch (e) {
            const texto = String(e.message ?? e);
            escribirBloque(texto, 'error');
            resultado = { stdout: '', stderr: texto, code: 1 };
        }
        pintarPrompt();
        actualizarEstado(resultado);
        opciones.onEstado?.({ ...resultado, guion });
        enganche?.(guion, resultado);
        return resultado;
    }
    // ---- teclado ----------------------------------------------------------

    campo.addEventListener('keydown', (evento) => {
        if (evento.ctrlKey && evento.key === 'c') {
            evento.preventDefault();
            sesion.interrumpir();
            escribirLinea(prompt.textContent + campo.textContent + '^C', 'entrada');
            campo.textContent = '';
            pintarPrompt();
            return;
        }
        if (evento.ctrlKey && evento.key === 'l') {
            evento.preventDefault();
            pantalla.textContent = '';
            return;
        }
        if (evento.key === 'Enter') {
            evento.preventDefault();
            ejecutar();
            return;
        }
        if (evento.key === 'Tab') {
            evento.preventDefault();
            completar(evento.shiftKey ? -1 : 1);
            return;
        }
        if (evento.key === 'ArrowUp' || evento.key === 'ArrowDown') {
            evento.preventDefault();
            moverHistorial(evento.key === 'ArrowUp' ? -1 : 1);
            return;
        }
        editable = campo.textContent;
    });

    campo.addEventListener('input', () => { editable = campo.textContent; });

    /** Flechas del historial. */
    function moverHistorial(delta) {
        const total = sesion.historial.length;
        if (!total) return;
        posicion = Math.max(0, Math.min(total, posicion + delta));
        campo.textContent = posicion === total ? '' : sesion.historial[posicion];
        editable = campo.textContent;
        moverCursorAlFinal();
    }

    /** TAB: completa comandos, ficheros y los ultimos argumentos. */
    function completar() {
        const texto = campo.textContent;
        const palabras = texto.split(/\s+/);
        const parcial = palabras[palabras.length - 1] ?? '';
        const sugerencias = sesion.sugerencias(parcial);
        if (!sugerencias.length) return;

        if (sugerencias.length === 1) {
            palabras[palabras.length - 1] = sugerencias[0];
            campo.textContent = palabras.join(' ');
            editable = campo.textContent;
            moverCursorAlFinal();
            return;
        }
        // Varias: se listan y se completa el prefijo comun.
        const comun = prefijoComun(sugerencias);
        if (comun.length > parcial.length) {
            palabras[palabras.length - 1] = comun;
            campo.textContent = palabras.join(' ');
        }
        editable = campo.textContent;
        moverCursorAlFinal();
        escribirLinea(sugerencias.join('  '), 'sugerencias');
    }

    function moverCursorAlFinal() {
        try {
            const rango = document.createRange();
            rango.selectNodeContents(campo);
            rango.collapse(false);
            const seleccion = window.getSelection();
            seleccion.removeAllRanges();
            seleccion.addRange(rango);
        } catch (e) { /* en jsdom puede no haber seleccion */ }
    }

    pintarPrompt();

    return {
        get sesion() { return sesion; },
        /** El panel de la mision se engancha aqui para ver cada comando. */
        set alEjecutar(fn) { enganche = fn; },
        get alEjecutar() { return enganche; },
        historial: () => sesion.historial,
        ultimoComando: () => ultimo,
        ejecutar,
        /** Escribe texto como si el alumno lo hubiera tecleado. */
        escribir(texto) {
            campo.textContent = texto;
            editable = texto;
        },
        limpiar() {
            pantalla.textContent = '';
        },
        /**
         * Devuelve la maquina a su estado inicial: arbol de ficheros original y
         * sin historial. Es lo que necesita el boton "reiniciar maquina", porque
         * hay misiones que dejan el sistema cambiado y las siguientes empiezan
         * sobre esa base.
         *
         * @param {string[]} [historial]  historial a conservar, si se quiere
         */
        reiniciar(historial = []) {
            sesion = crearSesion({ historial });
            posicion = sesion.historial.length;
            ultimo = null;
            campo.textContent = '';
            pantalla.textContent = '';
            pintarPrompt();
            actualizarEstado({ code: 0 });
            opciones.onReinicio?.();
            return sesion;
        },
        enfocar() {
            campo.focus();
        },
        escribirLinea,
        /** Salida acumulada, util para tests. */
        texto() {
            return pantalla.textContent;
        }
    };
}

/** Prefijo mas largo comun a una lista de sugerencias. */
function prefijoComun(lista) {
    if (!lista.length) return '';
    let comun = lista[0];
    for (const texto of lista.slice(1)) {
        while (!texto.startsWith(comun)) comun = comun.slice(0, -1);
        if (!comun) break;
    }
    return comun;
}

/**
 * Crea un elemento.
 *
 *   crear('p', { class: 'x', text: 'hola' })
 *   crear('div', { class: 'x' }, hijo1, hijo2)
 *
 * El segundo argumento son atributos; a partir del tercero son hijos, que se
 * anaden como nodos (nunca como HTML). El atributo `text` es una forma
 * comoda de escribir texto: por eso el texto se aplica despues de los hijos,
 * para que no se borre lo ya anadido.
 */
export function crear(etiqueta, atributos = {}, ...hijos) {
    const nodo = document.createElement(etiqueta);
    let texto = null;
    for (const [clave, valor] of Object.entries(atributos ?? {})) {
        if (valor === null || valor === undefined || valor === false) continue;
        if (clave === 'text') { texto = String(valor); continue; }
        nodo.setAttribute(clave, valor === true ? '' : String(valor));
    }
    for (const hijo of hijos.flat()) {
        if (hijo === null || hijo === undefined || hijo === false) continue;
        nodo.append(hijo);
    }
    if (texto !== null) nodo.append(document.createTextNode(texto));
    return nodo;
}