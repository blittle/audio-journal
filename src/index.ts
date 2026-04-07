import http from "http";
import { app } from "./server.js";
import { attachMediaStreamHandler } from "./media-stream.js";
import { startScheduler } from "./scheduler.js";
import { cleanOldTranscripts } from "./journal.js";
import { getAllUsers } from "./users.js";
import { config } from "./config.js";

console.log("Audio Journal Agent starting...");
console.log(`${getAllUsers().length} user(s) loaded`);

const server = http.createServer(app);
attachMediaStreamHandler(server);

server.listen(config.PORT, () => {
  console.log(`Server listening on port ${config.PORT}`);
  console.log(`WebSocket URL: ${config.WEBHOOK_URL}/media-stream`);
});

startScheduler();
cleanOldTranscripts();
