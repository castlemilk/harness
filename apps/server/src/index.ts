import { app } from './app.js';

const PORT = Number(process.env.PORT ?? 4000);

app.listen(PORT, () => {
  console.log(`Omega harness server on http://localhost:${PORT.toString()}`);
});
