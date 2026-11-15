// Punto de entrada para Vercel (función Node.js). Todas las rutas se reescriben aquí en vercel.json.
import { handle } from '@hono/node-server/vercel';
import { app } from '../src/app.js';

export default handle(app);
