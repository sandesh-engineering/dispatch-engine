import { app } from './app';
import { env } from './config/envs';

app.listen(env.PORT, () => {
  console.log(`Server is running in port ${env.PORT}!`);
});
