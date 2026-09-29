import '../css/style.css';
import { NIVELES, MODOS } from './levels.js';

const el = (tag, attrs = {}, ...hijos) => {
    const nodo = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (v === false || v === null || v === undefined) continue;
        if (k === 'text') nodo.textContent = v;
        else nodo.setAttribute(k, v);
    }
    for (const hijo of hijos) {
        if (hijo === null || hijo === undefined) continue;
        nodo.append(hijo);
    }
    return nodo;
};

const cuentaModos = () => {
    const cuenta = {};
    for (const n of NIVELES) cuenta[n.modo] = (cuenta[n.modo] || 0) + 1;
    return cuenta;
};

const raiz = document.getElementById('app');
raiz.replaceChildren(
    el('header', { class: 'cabecera' },
        el('div', { class: 'marca' },
            el('span', { class: 'prompt', text: 'agente@linuxlearn' }),
            el('span', { class: 'ruta', text: ':~$' })
        ),
        el('h1', { text: 'LinuxLearn' })
    ),

    el('main', { class: 'principal' },
        el('section', { class: 'hero' },
            el('p', { class: 'entradilla', text: 'Simulador de linea de ordenes de Linux que corre 100 % en tu navegador. El shell, los comandos y el sistema de ficheros estan escritos a mano en JavaScript: sin backend, sin emulacion, sin magia.' }),
            el('p', { class: 'acciones' },
                el('span', { class: 'comando', text: './empezar.sh' })
            )
        ),

        el('section', { class: 'panel' },
            el('h2', { text: 'El motor' }),
            el('ul', { class: 'lista' },
                el('li', { text: 'Shell propio: lexer, parser, expansion, tuberias, redirecciones, funciones, bucles, trap y set.' }),
                el('li', { text: 'Errores identicos a los de GNU coreutils, en ingles, como en la terminal real.' }),
                el('li', { text: 'Sistema de ficheros virtual sembrado de forma determinista: mismo arbol en cada sesion.' }),
                el('li', { text: 'Pruebas diferenciales contra el bash de Ubuntu en CI: cada caso se ejecuta en los dos.' })
            )
        ),

        el('section', { class: 'panel' },
            el('h2', { text: 'Misiones' }),
            el('div', { class: 'mallas' },
                ...MODOS.map((modo) => el('div', { class: 'malla' },
                    el('span', { class: 'cuenta', text: String(cuentaModos()[modo] || 0) }),
                    el('span', { class: 'etiqueta', text: modo })
                ))
            ),
            el('ul', { class: 'lista misiones' },
                ...NIVELES.slice(0, 6).map((n) => el('li', {},
                    el('span', { class: 'id', text: String(n.id).padStart(2, '0') }),
                    el('span', { class: 'titulo', text: n.titulo }),
                    el('span', { class: 'badges' },
                        el('span', { class: 'modo', text: n.modo }),
                        el('span', { class: 'dif', text: n.dificultad })
                    )
                ))
            ),
            el('p', { class: 'pie', text: `y ${NIVELES.length - 6} misiones mas: 32 en total, de Basico a Experto.` })
        ),

        el('section', { class: 'panel estado' },
            el('h2', { text: 'Estado del proyecto' }),
            el('p', { text: 'Sistema de ficheros, lexer, parser, expansion y los primeros comandos ya estan escritos y probados. El registro de comandos, builtins, shell.js y la interfaz del terminal siguen en marcha: consulta PROGRESO.md del repositorio.' })
        )
    ),

    el('footer', { class: 'pie-pagina' },
        el('a', { href: 'https://github.com/NotAYeen/LINUXLEARN', target: '_blank', rel: 'noopener', text: 'github.com/NotAYeen/LINUXLEARN' }),
        el('span', { text: ' · hecho en el navegador, sin dependencias de servidor' })
    )
);
