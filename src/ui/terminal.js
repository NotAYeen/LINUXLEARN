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
    const sesion = crearSesion();

    const pantalla = crear('div', { class: 'pantalla', role: 'log', 'aria-live': 'polite' });
    const lineaEntrada = crear('div', { class: 'linea-entrada' });
    const prompt = crear('span', { class: 'prompt' });
    const campo = crear('span', { class: 'campo', contenteditable: 'plaintext-only', spellcheck: 'false' });
    const cursor = crear('span', { class: 'cursor' });

    lineaEntrada.append(prompt, campo, cursor);
    raiz.append(pantalla, lineaEntrada);

    let historial = opciones.historialInicial ?? [];
    let posicion = historial.length;
    let editable = '';

    // ---- salida -----------------------------------------------------------

    /** Añade una linea a la pantalla. Nunca usa innerHTML. */
    function escribirLinea(texto, clase = '') {
        const linea = crear('div', { class: 'linea ' + clase });
        linea.textContent = texto === '' ? ' ' : texto;
        pantalla.append(linea);
        pantalla.scrollTop = pantalla.scrollHeight;
        return linea;
    }

    function escribirBloque(texto, clase) {
        const lineas = String(texto).replace(/\n$/, '').split('\n');
        for (const linea of lineas) escribirLinea(linea, clase);
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
        if (!guion) { pintarPrompt(); return; }
        historial.push(guion);
        posicion = historial.length;
        escribirLinea(sesion.prompt() + guion, 'entrada');
        campo.textContent = '';
        try {
            const r = sesion.ejecutar(guion);
            if (r.stdout) escribirBloque(r.stdout, 'salida');
            if (r.stderr) escribirBloque(r.stderr, 'error');
            opciones.onEstado?.({ code: r.code, stdout: r.stdout, stderr: r.stderr });
        } catch (e) {
            escribirBloque(String(e.message ?? e), 'error');
            opciones.onEstado?.({ code: 1, stdout: '', stderr: String(e.message ?? e) });
        }
        pintarPrompt();
        opciones.onSalida?.(historial);
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
        if (!historial.length) return;
        posicion = Math.max(0, Math.min(historial.length, posicion + delta));
        campo.textContent = posicion === historial.length ? '' : historial[posicion];
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
        sesion,
        historial: () => historial,
        ejecutar,
        /** Escribe texto como si el alumno lo hubiera tecleado. */
        escribir(texto) {
            campo.textContent = texto;
            editable = texto;
        },
        limpiar() {
            pantalla.textContent = '';
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