import { app } from "./src/main";

// Start the server. All app + swagger setup lives in src/main.ts
app.listen(process.env.PORT ?? 3004);

const { hostname, port } = app.server!;
console.log(`🔗 Shareability Service running at http://${hostname}:${port}`);
console.log(`📚 Swagger UI: http://${hostname}:${port}/swagger`);
console.log(`📄 OpenAPI JSON: http://${hostname}:${port}/swagger/json`);
