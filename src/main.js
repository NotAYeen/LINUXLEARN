/**
 * Punto de entrada de la interfaz: el terminal, el panel de mision y el
 * progreso. Solo esta capa toca el DOM; el motor (src/engine) no lo hace nunca.
 */

import '../css/style.css';
import { NIVELES, misionPorId } from './levels.js';
import { leerProgreso, siguienteMision, registrarSuperada } from './check.js';
import { montarTerminal, crear } from './ui/terminal.js';
import { montarPanel } from './ui/panel.js';

/** Estructura de la pagina: barra lateral con misiones y zona principal. */
function esqueleto() {
    const raiz = document.getElementById('app');
    raiz.textContent = '';

    const cabecera = crear('header', { class: 'cabecera' },
        crear('h1', { text: 'LinuxLearn' }),
        crear('p', { class: 'lema', text: 'Practica la linea de ordenes de Linux en tu navegador.' })
    );

    const lateral = crear('nav', { class: 'lateral', 'aria-label': 'Misiones' });
    const panel = crear('section', { class: 'panel-mision' });
    const terminal = crear('div', { class: 'terminal', 'aria-label': 'Terminal' });

    raiz.append(cabecera, crear('div', { class: 'cuerpo' }, lateral, crear('main', { class: 'principal' }, panel, terminal)));

    return { raiz, lateral, panel, terminal };
}

/** Lista lateral con el estado de cada mision. */
function pintarMisiones(contenedor, progreso, activa, alElegir) {
    contenedor.textContent = '';
    const completadas = Object.values(progreso.misiones).filter((m) => m.superada).length;

    contenedor.append(crear('p', { class: 'progreso' },
        crear('strong', { text: completadas + ' / ' + NIVELES.length }),
        ' misiones superadas'
    ));

    const lista = crear('ol', { class: 'misiones' });
    for (const mision of NIVELES) {
        const hecha = Boolean(progreso.misiones[mision.id]?.superada);
        const item = crear('li', {
            class: 'mision' + (hecha ? ' hecha' : '') + (mision.id === activa ? ' activa' : '')
        },
            crear('button', { class: 'mision-boton', type: 'button' },
                crear('span', { class: 'numero', text: String(mision.id) }),
                crear('span', { class: 'nombre', text: mision.titulo }),
                crear('span', { class: 'modo-mini', text: mision.modo })
            )
        );
        item.querySelector('button').addEventListener('click', () => alElegir(mision.id));
        lista.append(item);
    }
    contenedor.append(lista);
}

function arrancar() {
    const { lateral, panel, terminal } = esqueleto();
    const almacen = window.localStorage ?? null;
    let progreso = leerProgreso(almacen);
    let actual = progreso.ultimo ?? siguienteMision(progreso, NIVELES)?.id ?? 1;

    const tty = montarTerminal(terminal, {
        historialInicial: progreso.historial ?? [],
        onEstado: ({ code }) => {
            // El codigo de salida se muestra en la cabecera del panel: es la
            // pista principal cuando algo falla.
            const aviso = panel.querySelector('.codigo-salida');
            if (aviso) {
                aviso.textContent = 'codigo de salida: ' + code;
                aviso.classList.toggle('error', code !== 0);
            }
        }
    });

    function mostrar(id) {
        const mision = misionPorId(id);
        if (!mision) return;
        actual = id;
        progreso.ultimo = id;
        progreso.historial = tty.historial();
        progreso.misiones[id] = { ...progreso.misiones[id], abierta: true };
        try { window.localStorage?.setItem('lxl_progreso', JSON.stringify(progreso)); } catch (e) { /* modo privado */ }
        montarPanel(panel, mision, {
            almacen,
            sesion: undefined,
            onSuperada: () => {
                progreso = leerProgreso(almacen);
                progreso.ultimo = id;
                progreso.historial = tty.historial();
                pintarMisiones(lateral, progreso, actual, mostrar);
            }
        });
        pintarMisiones(lateral, progreso, actual, mostrar);
    }

    pintarMisiones(lateral, progreso, actual, mostrar);
    mostrar(actual);
    tty.enfocar();

    // El terminal global para cuando el alumno escribe el comando de la mision.
    document.addEventListener('keydown', (evento) => {
        if (evento.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) {
            evento.preventDefault();
            tty.enfocar();
        }
    });
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arrancar);
    else arrancar();
}

export { arrancar };