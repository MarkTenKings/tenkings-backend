import { createApp } from "./app.js";

const port = process.env.PORT ? Number(process.env.PORT) : 8080;
const serviceName = "wallet-service";

const app = createApp();

app.listen(port, () => {
  console.log(`(${serviceName}) listening on port ${port}`);
});
