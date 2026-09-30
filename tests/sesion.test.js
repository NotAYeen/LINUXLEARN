/**
 * @vitest-environment jsdom
 * Simula una sesion completa de alumno: escribe en la terminal, ve la salida y
 * comprueba que el panel reacciona a cada comando.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { montarTerminal } from '../src/ui/terminal.js';
import { montarPanel } from '../src/ui/panel.js';
import { NIVELES } from '../src/levels.js';
import { montarAcciones } from '../src/ui/acciones.js';
import { leerProgreso, registrarSesion, registrarSuperada } from '../src/check.js';
import { arrancar } from '../src/main.js';

describe('sesion de alumno', () => {
    let raiz;
    beforeEach(() => {
        document.body.innerHTML = '<div id="app"></div>';
        raiz = document.getElementById('app');
    });

    it('reproduce una sesion tipica de seis comandos', () => {
        const zonaTerminal = document.createElement('div');
        const zonaPanel = document.createElement('div');
        raiz.append(zonaTerminal, zonaPanel);

        const mision = NIVELES.find((m) => m.id === 12);
        const tty = montarTerminal(zonaTerminal, {});
        const { alComando } = montarPanel(zonaPanel, mision, { siguienteMision: () => {} });
        tty.alEjecutar = (guion) => alComando(guion);

        const escribir = (texto) => { tty.escribir(texto); tty.ejecutar(); };

        // 1. Un comando tonto: el panel no dice nada, la terminal ya lo enseño.
        escribir('ls -a /var/log');
        expect(zonaPanel.querySelector('.seguimiento').className).toContain('esperando');
        expect(tty.texto()).toContain('app.log');

        // 2. Un comando que falla: se ve el error de verdad en la terminal.
        escribir('grep INFO /var/log/noexiste');
        expect(tty.texto()).toContain('No such file or directory');
        expect(zonaPanel.querySelector('.seguimiento').className).toContain('esperando');

        // 3. Insiste con comandos que no son el de la mision: a partir del
        //    tercer intento el panel da una pista en vez de seguir callado.
        escribir('wc -l /var/log/app.log');
        escribir('ls /var/log');
        escribir('head -n 1 /var/log/app.log');
        expect(zonaPanel.querySelector('.seguimiento').className).toContain('mal');

        // 4. El comando correcto: la pantalla se pone verde, sin pulsar nada.
        escribir(mision.soluciones[0]);
        expect(zonaPanel.querySelector('.seguimiento').className).toContain('ok');
        expect(zonaPanel.querySelector('.seguimiento').textContent).toContain('Correcto');
        expect(zonaPanel.querySelector('.boton.siguiente')).toBeTruthy();

        // 5. Y el prompt refleja el estado del shell, no una copia.
        escribir('cd /var/log');
        escribir('pwd');
        expect(tty.texto()).toContain('/var/log');

        // El historial guarda todo lo escrito, en orden (8 comandos).
        expect(tty.historial().length).toBe(8);
    });

    it('el panel cambia al cambiar de mision y deja de mirar la anterior', () => {
        const zonaTerminal = document.createElement('div');
        const zonaPanel = document.createElement('div');
        raiz.append(zonaTerminal, zonaPanel);

        const tty = montarTerminal(zonaTerminal, {});
        const { alComando: alPrimero } = montarPanel(zonaPanel, NIVELES[0], {});
        tty.alEjecutar = (guion) => alPrimero(guion);

        tty.escribir('pwd');
        tty.ejecutar();
        expect(zonaPanel.querySelector('.seguimiento').className).toContain('ok');

        // Cambio de mision: el comando anterior ya no cuenta. El mismo `pwd` que
        // resolvia la primera no vale para la doce, y el panel no dice nada aun.
        const { alComando: alSegundo } = montarPanel(zonaPanel, NIVELES[11], {});
        tty.alEjecutar = (guion) => alSegundo(guion);
        tty.escribir('pwd');
        tty.ejecutar();
        expect(zonaPanel.querySelector('.seguimiento').className).toContain('esperando');

        // Pero el comando de la doce si se reconoce al momento.
        tty.escribir(NIVELES[11].soluciones[0]);
        tty.ejecutar();
        expect(zonaPanel.querySelector('.seguimiento').className).toContain('ok');
    });
});
describe('recargar la pagina', () => {
    /** `localStorage` de mentira, como en `ui.test.js`. */
    function almacenFalso() {
        const datos = new Map();
        return {
            getItem: (k) => (datos.has(k) ? datos.get(k) : null),
            setItem: (k, v) => datos.set(k, String(v)),
            removeItem: (k) => datos.delete(k)
        };
    }

    it('el historial y las misiones vuelven despues de recargar', () => {
        const almacen = almacenFalso();

        // --- primera visita: el alumno trabaja y supera una mision.
        const zonaTerminal = document.createElement('div');
        const zonaPanel = document.createElement('div');
        const zonaBarra = document.createElement('div');
        document.body.append(zonaTerminal, zonaPanel, zonaBarra);

        const tty = montarTerminal(zonaTerminal, {});
        const acciones = montarAcciones(zonaBarra, { almacen, tty, idMision: 12 });
        const { alComando: alPanel } = montarPanel(zonaPanel, NIVELES[11], { almacen });
        tty.alEjecutar = (guion) => alPanel(guion);

        tty.escribir('cd /var/log');
        tty.ejecutar();
        tty.escribir(NIVELES[11].soluciones[0]);
        tty.ejecutar();
        expect(zonaPanel.querySelector('.seguimiento').className).toContain('ok');
        acciones.guardaSesion(12, tty.historial());

        // --- recarga: pagina nueva, mismo almacenamiento.
        zonaTerminal.remove();
        zonaPanel.remove();
        zonaBarra.remove();

        const nuevaTerminal = document.createElement('div');
        const nuevaBarra = document.createElement('div');
        document.body.append(nuevaTerminal, nuevaBarra);
        const tty2 = montarTerminal(nuevaTerminal, { historialInicial: leerProgreso(almacen).historial });
        montarAcciones(nuevaBarra, { almacen, tty: tty2, idMision: 12 });

        // El historial se recupera: las flechas tienen de donde tirar y `history`
        // cuenta lo mismo que antes de recargar.
        expect(tty2.historial()).toEqual(['cd /var/log', NIVELES[11].soluciones[0]]);
        tty2.escribir('history');
        tty2.ejecutar();
        expect(tty2.texto()).toContain('cd /var/log');

        // Y las misiones superadas siguen ahi.
        expect(leerProgreso(almacen).misiones[12].superada).toBe(true);
        registrarSuperada(almacen, 1);
        expect(leerProgreso(almacen).misiones[12].superada).toBe(true);
    });
});
describe('la aplicacion entera', () => {
    const almacenSano = () => window.localStorage;
    beforeEach(() => {
        document.body.innerHTML = '<div id="app"></div>';
        window.localStorage.clear();
    });

    it('arranca y monta terminal, panel y barra de acciones', () => {
        arrancar();
        const app = document.getElementById('app');
        expect(app.querySelector('.terminal .campo')).toBeTruthy();
        expect(app.querySelector('.panel-mision')).toBeTruthy();
        expect(app.querySelector('.acciones-cabecera')).toBeTruthy();
        // La barra lateral ense�a el avance, con barra y porcentaje.
        expect(app.querySelector('.barra-progreso .relleno').getAttribute('style')).toContain('width: 0%');
        expect(app.querySelector('.misiones').children.length).toBe(32);
    });

    it('acertar una mision actualiza la lateral sin recargar', () => {
        arrancar();
        const app = document.getElementById('app');
        const tty = app.querySelector('.campo');
        // Mision 1 es `pwd`, y la terminal arranca en el directorio personal.
        tty.textContent = 'pwd';
        app.querySelector('.campo').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

        // La lateral se entera al momento: la mision queda marcada y la barra
        // de progreso se mueve, sin recargar la pagina.
        expect(app.querySelector('.mision').className).toContain('hecha');
        expect(app.querySelector('.barra-progreso .relleno').getAttribute('style')).toMatch(/width: [\d.]+%/);
        expect(window.localStorage.getItem('lxl_progreso')).toContain('"superada":true');
    });

    it('el boton de restablecer exige dos pulsaciones', () => {
        arrancar();
        const app = document.getElementById('app');
        const campo = app.querySelector('.campo');
        campo.textContent = 'pwd';
        campo.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(window.localStorage.getItem('lxl_progreso')).toContain('"superada":true');

        const [, , botonRestablecer] = app.querySelectorAll('.acciones-cabecera button');
        botonRestablecer.click();
        // Primera pulsacion: sigue todo intacto y se explica el peligro.
        expect(window.localStorage.getItem('lxl_progreso')).toContain('"superada":true');
        expect(app.querySelector('.aviso-peligro').hidden).toBe(false);

        botonRestablecer.click();
        // Ya no hay ninguna mision superada, aunque la app vuelva a guardar que
        // has abierto la primera (eso es lo que hace al reiniciar por ahi).
        expect(leerProgreso(almacenSano()).misiones[1].superada).toBe(false);
        expect(Object.values(leerProgreso(almacenSano()).misiones).filter((m) => m.superada).length).toBe(0);
        // Y la pagina vuelve a la primera mision, sin nada superado.
        expect(app.querySelector('.barra-progreso .relleno').getAttribute('style')).toContain('width: 0%');
        expect(app.querySelector('.mision.activa .numero').textContent).toBe('1');
    });

    it('reiniciar la maquina deja el arbol como estaba', () => {
        arrancar();
        const app = document.getElementById('app');
        const campo = app.querySelector('.campo');
        campo.textContent = 'mkdir /tmp/recargado';
        campo.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(campo.textContent).toBe('');

        const [botonMaquina] = app.querySelectorAll('.acciones-cabecera button');
        botonMaquina.click();
        expect(app.querySelector('.terminal .pantalla').textContent).toContain('Maquina reiniciada');

        campo.textContent = 'ls /tmp';
        campo.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(app.querySelector('.terminal .pantalla').textContent).not.toContain('recargado');
    });
});