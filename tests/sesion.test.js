/**
 * @vitest-environment jsdom
 * Simula una sesion completa de alumno: escribe en la terminal, ve la salida y
 * comprueba que el panel reacciona a cada comando.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { montarTerminal } from '../src/ui/terminal.js';
import { montarPanel } from '../src/ui/panel.js';
import { NIVELES } from '../src/levels.js';

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
        const { enganche } = montarPanel(zonaPanel, mision, { siguienteMision: () => {} });
        tty.alEjecutar = (guion) => enganche.comandoEjecutado(guion);

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
        const primero = montarPanel(zonaPanel, NIVELES[0], {});
        tty.alEjecutar = (guion) => primero.enganche.comandoEjecutado(guion);

        tty.escribir('pwd');
        tty.ejecutar();
        expect(zonaPanel.querySelector('.seguimiento').className).toContain('ok');

        // Cambio de mision: el comando anterior ya no cuenta. El mismo `pwd` que
        // resolvia la primera no vale para la doce, y el panel no dice nada aun.
        const segundo = montarPanel(zonaPanel, NIVELES[11], {});
        tty.alEjecutar = (guion) => segundo.enganche.comandoEjecutado(guion);
        tty.escribir('pwd');
        tty.ejecutar();
        expect(zonaPanel.querySelector('.seguimiento').className).toContain('esperando');

        // Pero el comando de la doce si se reconoce al momento.
        tty.escribir(NIVELES[11].soluciones[0]);
        tty.ejecutar();
        expect(zonaPanel.querySelector('.seguimiento').className).toContain('ok');
    });
});
