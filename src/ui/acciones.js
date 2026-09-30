/**
 * Barra de acciones: lo que el alumno necesita para gobernar su progreso.
 *
 * Son cuatro cosas, y todas viven aqui en vez de repartidas por `main.js`:
 *
 *  - **Reiniciar la maquina.** Hay misiones que cambian el arbol de ficheros (el
 *    script de despliegue deja el sistema a medias). Sin esto, las siguientes
 *    misiones empiezan sobre una base sucia y el alumno no tiene forma de
 *    volver atras. No toca el progreso.
 *  - **Rehacer una mision.** Quita la marca de superada para poder repetirla.
 *  - **Exportar / importar el progreso.** El progreso vive en el navegador, que
 *    se puede limpiar en cualquier momento o cambiar de dispositivo. Exportar
 *    es copiar un texto; importar es pegarlo.
 *  - **Restablecer el progreso entero.** Es lo destructivo de verdad (se van 32
 *    misiones), asi que exige dos pulsaciones y explica lo que va a pasar: no
 *    hay modales que mantener y no se pierde trabajo por un clic de mas.
 *
 * El modulo no toca el progreso por su cuenta: recibe `almacen` y callbacks y
 * llama a `src/check.js`, que es el unico que escribe en `localStorage`.
 */

import {
    desmarcarMision, exportarProgreso, guardarProgreso, importarProgreso,
    leerProgreso, registrarSesion, restablecerProgreso
} from '../check.js';
import { crear } from './terminal.js';

/**
 * Monta la barra.
 *
 * @param {HTMLElement} raiz  donde se pinta
 * @param {object} opciones
 * @param {object} opciones.almacen  el `localStorage`, o null
 * @param {object} opciones.tty       el terminal, para `reiniciar()`
 * @param {function} opciones.alCambiarProgreso  se llama tras cualquier cambio
 * @param {function} [opciones.idMision]  mision abierta, para "rehacer"
 */
export function montarAcciones(raiz, opciones) {
    const { almacen, tty } = opciones;
    let misionAbierta = opciones.idMision ?? null;

    const aviso = crear('p', { class: 'aviso-acciones', role: 'status' });

    // ---- botones simples --------------------------------------------------

    const botonMaquina = crear('button', { class: 'boton discreto', type: 'button', text: 'Reiniciar maquina' });
    botonMaquina.addEventListener('click', () => {
        // Sin confirmacion: el progreso se conserva y repetir el comando basta
        // para recuperar lo que hubiera. Perder 32 misiones si en ese caso.
        tty.reiniciar([]);
        escribirLinea('Maquina reiniciada: el arbol de ficheros vuelve a su estado inicial.');
        tty.enfocar();
        opciones.alCambiarProgreso?.();
    });

    const botonRehacer = crear('button', { class: 'boton discreto', type: 'button', text: 'Rehacer esta mision' });
    botonRehacer.addEventListener('click', () => {
        if (!misionAbierta) return;
        if (!desmarcarMision(almacen, misionAbierta)) {
            avisar('No se ha podido guardar. Puede que el navegador este en modo privado.', 'error');
            return;
        }
        avisar('Mision ' + misionAbierta + ' vuelve a estar pendiente. Ya puedes rehacerla.', 'ok');
        opciones.alCambiarProgreso?.();
        tty.enfocar();
    });

    // ---- restablecer el progreso (dos pulsaciones) ------------------------

    const botonRestablecer = crear('button', { class: 'boton peligro', type: 'button', text: 'Restablecer progreso' });
    const explicacion = crear('p', { class: 'aviso-peligro', text: 'Se borran las misiones superadas y el historial de la terminal. No se puede deshacer.' });
    explicacion.hidden = true;
    let esperando = false;

    botonRestablecer.addEventListener('click', () => {
        if (!esperando) {
            // Primera pulsacion: se pregunta, y el boton cambia para que la
            // segunda sea consciente.
            esperando = true;
            explicacion.hidden = false;
            botonRestablecer.textContent = 'Pulse otra vez para borrar todo';
            botonRestablecer.classList.add('confirmando');
            return;
        }
        esperando = false;
        explicacion.hidden = true;
        botonRestablecer.textContent = 'Restablecer progreso';
        botonRestablecer.classList.remove('confirmando');
        if (!restablecerProgreso(almacen)) {
            avisar('No se ha podido borrar: el navegador no deja tocar el almacenamiento.', 'error');
            return;
        }
        avisar('Progreso borrado. Empiezas de nuevo en la mision 1.', 'ok');
        opciones.alCambiarProgreso?.({ restablecido: true });
        tty.reiniciar([]);
        tty.enfocar();
    });

    /** Cancela la confirmacion si el alumno se va a otra parte. */
    function cancelarConfirmacion() {
        if (!esperando) return;
        esperando = false;
        explicacion.hidden = true;
        botonRestablecer.textContent = 'Restablecer progreso';
        botonRestablecer.classList.remove('confirmando');
    }

    // ---- exportar e importar ---------------------------------------------

    const caja = crear('textarea', { class: 'caja-progreso', spellcheck: 'false', rows: '3' });

    const botonExportar = crear('button', { class: 'boton discreto', type: 'button', text: 'Exportar progreso' });
    botonExportar.addEventListener('click', async () => {
        const texto = exportarProgreso(almacen);
        caja.value = texto;
        caja.hidden = false;
        caja.select();
        // El portapapeles no siempre esta disponible (http, permisos), asi que
        // el texto se enseña siempre: se copia a mano si hace falta.
        let copiado = false;
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(texto);
                copiado = true;
            }
        } catch (e) { /* sin portapapeles: no es un error */ }
        avisar(copiado
            ? 'Progreso copiado. Guardalo donde quieras por si borras los datos del navegador.'
            : 'Progreso generado. Copialo de la caja de abajo.', copiado ? 'ok' : 'aviso');
    });

    const botonImportar = crear('button', { class: 'boton discreto', type: 'button', text: 'Importar progreso' });
    botonImportar.addEventListener('click', () => {
        caja.hidden = false;
        caja.focus();
        caja.select();
        avisar('Pega aqui el progreso que exportaste y pulsa "Importar".');
    });

    const botonConfirmarImportar = crear('button', { class: 'boton', type: 'button', text: 'Importar' });
    botonConfirmarImportar.addEventListener('click', () => {
        const { progreso, error } = importarProgreso(caja.value);
        if (error) {
            avisar('No se ha importado: ' + error, 'error');
            return;
        }
        if (!guardarProgreso(almacen, progreso)) {
            avisar('El progreso es valido pero el navegador no deja guardarlo.', 'error');
            return;
        }
        const superadas = Object.values(progreso.misiones).filter((m) => m.superada).length;
        avisar('Importado: ' + superadas + ' misiones superadas.', 'ok');
        opciones.alCambiarProgreso?.({ importado: true });
    });

    const bloqueImportar = crear('details', { class: 'progreso-caja' },
        crear('summary', { text: 'Exportar o importar el progreso' }),
        crear('p', { class: 'pista', text: 'El progreso vive en este navegador. Copia el texto si quieres conservarlo en otro dispositivo.' }),
        caja,
        crear('div', { class: 'acciones' }, botonExportar, botonImportar, botonConfirmarImportar)
    );
    caja.hidden = true;

    raiz.append(
        crear('div', { class: 'acciones-cabecera' }, botonMaquina, botonRehacer, botonRestablecer),
        explicacion,
        bloqueImportar,
        aviso
    );

    // ---- avisos -----------------------------------------------------------

    function avisar(texto, tipo = 'info') {
        aviso.textContent = texto;
        aviso.className = 'aviso-acciones ' + tipo;
    }

    function escribirLinea(texto) {
        tty.escribirLinea(texto, 'aviso');
    }

    return {
        aviso: () => aviso.textContent,
        cancelaConfirmacion: cancelarConfirmacion,
        /** Marca el boton de rehacer segun corresponda. */
        sincroniza(idMision, superada) {
            misionAbierta = idMision;
            botonRehacer.hidden = !superada;
        },
        caja: () => caja,
        botonRestablecer: () => botonRestablecer,
        botonRehacer: () => botonRehacer,
        botonMaquina: () => botonMaquina,
        botonExportar: () => botonExportar,
        botonImportar: () => botonImportar,
        botonConfirmarImportar: () => botonConfirmarImportar,
        /** Avisa una sola vez si el almacenamiento no responde. */
        compruebaAlmacenamiento() {
            if (!almacen) {
                avisar('Este navegador no deja guardar el progreso (modo privado). Se puede practicar igual.', 'aviso');
                return false;
            }
            const progreso = leerProgreso(almacen);
            if (!guardarProgreso(almacen, progreso)) {
                avisar('El navegador no responde y el progreso no se esta guardando.', 'error');
                return false;
            }
            return true;
        },
        /** Guarda la posicion actual; lo llama la interfaz al cambiar de mision. */
        guardaSesion: (idMision, historial) => registrarSesion(almacen, idMision, historial)
    };
}