import { createServer } from 'node:http';
import mongoose from 'mongoose';
import { app } from '../../src/app.js';
import Order from '../../src/models/Order.js';

await mongoose.connect(process.env.MONGODB_URI);
await Order.init();
const server = createServer(app);
server.listen(0, '127.0.0.1', () => process.send(server.address().port));
